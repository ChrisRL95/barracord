// Windows process-loopback bridge. stdout: framed 48 kHz stereo PCM16.
// Each packet is uint32 sourceIndex, uint32 byteLength, then PCM (little endian).
// Uses the documented ActivateAudioInterfaceAsync process-loopback API.
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <atomic>
#include <thread>
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <io.h>
#include <tlhelp32.h>
#include <unordered_map>
#include <mutex>
#include <cstdint>

using namespace Microsoft::WRL;
static std::atomic<bool> stopping{false};
static std::atomic<int> started{0};
static std::mutex outputMutex;

class Activation final : public RuntimeClass<RuntimeClassFlags<ClassicCom>,
    FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
    HANDLE done = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    HRESULT result = E_PENDING;
    ComPtr<IAudioClient> client;
    ~Activation() { CloseHandle(done); }
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
        ComPtr<IUnknown> activated;
        HRESULT activationResult = E_FAIL;
        result = operation->GetActivateResult(&activationResult, &activated);
        if (SUCCEEDED(result)) result = activationResult;
        if (SUCCEEDED(result)) result = activated.As(&client);
        SetEvent(done);
        return S_OK;
    }
};

static int fail(HRESULT hr) {
    fprintf(stderr, "ERROR 0x%08lX\n", static_cast<unsigned long>(hr));
    fflush(stderr);
    return 1;
}

static int captureWindow(HWND window, DWORD pid, uint32_t index, int total) {
    HANDLE target = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!target) return fail(HRESULT_FROM_WIN32(GetLastError()));
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) { CloseHandle(target); return fail(hr); }
    auto activation = Make<Activation>();
    AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
    parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parameters.ProcessLoopbackParams.TargetProcessId = pid;
    parameters.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT properties{};
    properties.vt = VT_BLOB;
    properties.blob.cbSize = sizeof(parameters);
    properties.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        __uuidof(IAudioClient), &properties, activation.Get(), &operation);
    if (FAILED(hr)) return fail(hr);
    if (WaitForSingleObject(activation->done, 10000) != WAIT_OBJECT_0) return fail(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
    if (FAILED(activation->result)) return fail(activation->result);
    auto client = activation->client;
    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 2;
    format.nSamplesPerSec = 48000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 4;
    format.nAvgBytesPerSec = 192000;
    hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        0, 0, &format, nullptr);
    if (FAILED(hr)) return fail(hr);
    HANDLE samples = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!samples) return fail(HRESULT_FROM_WIN32(GetLastError()));
    hr = client->SetEventHandle(samples);
    if (FAILED(hr)) return fail(hr);
    ComPtr<IAudioCaptureClient> capture;
    hr = client->GetService(IID_PPV_ARGS(&capture));
    if (FAILED(hr)) return fail(hr);
    hr = client->Start();
    if (FAILED(hr)) return fail(hr);
    if (++started == total) { fprintf(stderr, "READY 48000 2 MULTI1\n"); fflush(stderr); }
    while (!stopping && WaitForSingleObject(target, 0) == WAIT_TIMEOUT && IsWindow(window)) {
        DWORD wait = WaitForSingleObject(samples, 200);
        if (wait == WAIT_TIMEOUT) continue;
        if (wait != WAIT_OBJECT_0) { hr = E_FAIL; break; }
        UINT32 count = 0;
        hr = capture->GetNextPacketSize(&count);
        while (SUCCEEDED(hr) && count > 0 && !stopping) {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr)) break;
            size_t length = static_cast<size_t>(frames) * format.nBlockAlign;
            std::vector<BYTE> silence;
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.resize(length, 0); data = silence.data(); }
            bool written;
            {
                std::lock_guard<std::mutex> lock(outputMutex);
                const uint32_t header[] = {index, static_cast<uint32_t>(length)};
                written = fwrite(header, 1, sizeof(header), stdout) == sizeof(header)
                    && fwrite(data, 1, length, stdout) == length;
            }
            HRESULT released = capture->ReleaseBuffer(frames);
            if (!written) { stopping = true; break; }
            if (FAILED(released)) { hr = released; break; }
            hr = capture->GetNextPacketSize(&count);
        }
        if (FAILED(hr)) break;
    }
    client->Stop();
    CloseHandle(samples);
    CloseHandle(target);
    // Process termination releases COM and the detached stdin reader together.
    return FAILED(hr) ? fail(hr) : 0;
}

static int runIsoBackslashHotkey(const wchar_t* flags) {
    wchar_t* end = nullptr;
    const auto modifiers = wcstoul(flags, &end, 10);
    if (end == flags || *end || modifiers > 15) return 1;

    constexpr int hotkeyId = 1;
    if (!RegisterHotKey(nullptr, hotkeyId, static_cast<UINT>(modifiers) | MOD_NOREPEAT, VK_OEM_102)) return 2;
    MSG message{};
    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
    const auto threadId = GetCurrentThreadId();
    std::thread([threadId] {
        // The pipe closes when Electron exits, even if it crashes.
        while (getchar() != EOF) {}
        PostThreadMessageW(threadId, WM_QUIT, 0, 0);
    }).detach();
    puts("ready");
    fflush(stdout);
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (message.message != WM_HOTKEY || message.wParam != hotkeyId) continue;
        puts("pressed");
        fflush(stdout);
    }
    UnregisterHotKey(nullptr, hotkeyId);
    return 0;
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 3 && wcscmp(argv[1], L"--iso-backslash-hotkey") == 0) return runIsoBackslashHotkey(argv[2]);
    if (argc < 2 || argc > 9) return fail(E_INVALIDARG);
    struct Source { HWND window; DWORD pid; };
    std::vector<Source> requested;
    for (int i = 1; i < argc; i++) {
        wchar_t* end = nullptr;
        const auto value = wcstoull(argv[i], &end, 10);
        if (!value || !end || *end) return fail(E_INVALIDARG);
        HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(value));
        DWORD pid = 0;
        if (!IsWindow(window) || !GetWindowThreadProcessId(window, &pid) || !pid) return fail(E_INVALIDARG);
        bool duplicate = false;
        for (const auto& source : requested) if (source.pid == pid) duplicate = true;
        if (!duplicate) requested.push_back({window, pid});
    }
    // Each capture includes children. Skip a requested child if its parent
    // tree is already selected, preventing the same samples being mixed twice.
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return fail(HRESULT_FROM_WIN32(GetLastError()));
    std::unordered_map<DWORD, DWORD> parents;
    PROCESSENTRY32 entry{}; entry.dwSize = sizeof(entry);
    if (Process32First(snapshot, &entry)) do { parents[entry.th32ProcessID] = entry.th32ParentProcessID; } while (Process32Next(snapshot, &entry));
    CloseHandle(snapshot);
    std::vector<Source> sources;
    for (const auto& source : requested) {
        DWORD parent = source.pid;
        bool covered = false;
        for (int depth = 0; depth < 128 && parents.count(parent); depth++) {
            const DWORD next = parents[parent];
            if (!next || next == parent) break;
            parent = next;
            for (const auto& other : requested) if (other.pid != source.pid && other.pid == parent) covered = true;
            if (covered) break;
        }
        if (!covered) sources.push_back(source);
    }
    if (sources.empty()) return fail(E_INVALIDARG);
    _setmode(_fileno(stdout), _O_BINARY);
    setvbuf(stdout, nullptr, _IONBF, 0);
    std::thread input([] { char value; while (_read(_fileno(stdin), &value, 1) > 0) {} stopping = true; });
    input.detach();
    std::atomic<int> failures{0};
    std::vector<std::thread> workers;
    for (size_t i = 0; i < sources.size(); i++) {
        const auto source = sources[i];
        workers.emplace_back([source, i, &sources, &failures] {
            if (captureWindow(source.window, source.pid, static_cast<uint32_t>(i), static_cast<int>(sources.size()))) ++failures;
            // Fail closed as a group if an application ends; never continue
            // with an unexpected partial mix or fall back to system sound.
            stopping = true;
        });
    }
    for (auto& worker : workers) worker.join();
    return failures ? 1 : 0;
}
