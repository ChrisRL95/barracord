// Test fixture only; not included in installers. Creates a hidden window and
// emits a quiet tone through Windows' default audio output for isolation tests.
#include <windows.h>
#include <mmsystem.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <thread>
#include <atomic>
#include <io.h>
static std::atomic<bool> stopped{false};
int main(int argc, char** argv) {
    if (argc != 2 && argc != 3) return 1;
    const double frequency = atof(argv[1]);
    if (frequency < 100 || frequency > 5000) return 1;
    WNDCLASSW wc{};
    wc.lpfnWndProc = DefWindowProcW;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = L"BarracordAudioTest";
    RegisterClassW(&wc);
    HWND window = CreateWindowW(wc.lpszClassName, L"Barracord audio test", WS_OVERLAPPEDWINDOW,
        0, 0, 200, 100, nullptr, nullptr, wc.hInstance, nullptr);
    if (!window) return 2;
    HWND secondWindow = argc == 3 ? CreateWindowW(wc.lpszClassName, L"Second window of the same audio process", WS_OVERLAPPEDWINDOW,
        0, 0, 200, 100, nullptr, nullptr, wc.hInstance, nullptr) : nullptr;
    if (argc == 3 && !secondWindow) return 2;
    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 2;
    format.nSamplesPerSec = 48000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 4;
    format.nAvgBytesPerSec = 192000;
    HWAVEOUT output{};
    if (waveOutOpen(&output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) return 3;
    std::vector<short> samples(48000 * 2 * 10);
    for (size_t i = 0; i < samples.size() / 2; i++) {
        short value = static_cast<short>(std::sin(6.283185307179586 * frequency * i / 48000) * 1000);
        samples[i * 2] = value;
        samples[i * 2 + 1] = value;
    }
    WAVEHDR header{};
    header.lpData = reinterpret_cast<LPSTR>(samples.data());
    header.dwBufferLength = static_cast<DWORD>(samples.size() * sizeof(short));
    if (waveOutPrepareHeader(output, &header, sizeof(header)) != MMSYSERR_NOERROR) return 4;
    if (waveOutWrite(output, &header, sizeof(header)) != MMSYSERR_NOERROR) return 5;
    if (secondWindow) printf("%llu %llu\n", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(window)), static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(secondWindow)));
    else printf("%llu\n", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(window)));
    fflush(stdout);
    std::thread reader([] { char c; while (_read(_fileno(stdin), &c, 1) > 0) {} stopped = true; });
    reader.detach();
    const ULONGLONG deadline = GetTickCount64() + 12000;
    while (!stopped && GetTickCount64() < deadline) {
        MSG message;
        while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&message); DispatchMessage(&message); }
        Sleep(10);
    }
    waveOutReset(output);
    waveOutUnprepareHeader(output, &header, sizeof(header));
    waveOutClose(output);
    DestroyWindow(window);
    if (secondWindow) DestroyWindow(secondWindow);
    return 0;
}
