const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const path = require('node:path')

if (process.platform !== 'win32') throw new Error('A captura por aplicativo é exclusiva do Windows.')
const root = path.resolve(__dirname, '..')
const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
const installation = execFileSync(vswhere, ['-all', '-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
const compilerEnvironment = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
if (!installation || !existsSync(compilerEnvironment)) throw new Error('Instale Visual Studio Build Tools com C++ e Windows SDK.')
const output = path.join(root, 'tools', 'app-audio')
mkdirSync(output, { recursive: true })
const quote = (value) => `"${value}"`
const command = `${quote(compilerEnvironment)} >nul && cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /DUNICODE /D_UNICODE ${quote(path.join(root, 'native', 'app-audio', 'capture.cpp'))} /Fo${quote(path.join(output, 'capture.obj'))} /Fe${quote(path.join(output, 'barracord-app-audio.exe'))} /link ole32.lib mmdevapi.lib user32.lib`
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
if (process.argv.includes('--test-tools')) {
  const testCommand = `${quote(compilerEnvironment)} >nul && cl /nologo /std:c++17 /EHsc /O2 /MT /W4 ${quote(path.join(root, 'native', 'app-audio', 'test-tone.cpp'))} /Fo${quote(path.join(output, 'test-tone.obj'))} /Fe${quote(path.join(output, 'test-tone.exe'))} /link user32.lib winmm.lib`
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${testCommand}"`], { stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
}
