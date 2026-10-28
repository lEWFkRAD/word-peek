const fs = require('node:fs')
const path = require('node:path')
const { dependency, nodePaths } = require('./runtime.cjs')
const modes = ['--install', '--release', '--check'].filter(flag => process.argv.includes(flag))
if (modes.length > 1) throw new Error('Choose only one of --install, --release, or --check.')
const mode = modes[0]
const localRoot = path.resolve(__dirname, '../..')
const root = path.basename(localRoot) === 'desktop-plugins' ? path.dirname(localRoot) : localRoot
const releases = ['desktop/plugin.js', 'word-peek/plugin.js', 'desktop-plugins/word-peek/plugin.js'].map(file => path.join(root, file))
if (mode === '--install' && (!process.env.HERMES_HOME || !fs.statSync(process.env.HERMES_HOME, { throwIfNoEntry: false })?.isDirectory())) {
  throw new Error('Set HERMES_HOME to the existing Hermes data directory before installing.')
}
const result = dependency('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'plugin.js')], absWorkingDir: __dirname,
  outfile: path.join(__dirname, 'dist/plugin.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'chrome120',
  external: ['@hermes/plugin-sdk'], nodePaths, write: false, minify: false
})
const bundle = Buffer.from(result.outputFiles[0].contents)
const notice = fs.readFileSync(path.join(root, 'word-peek/THIRD-PARTY-NOTICES.txt'))
const sourceDir = path.join(root, 'word-peek/dev')
const mirrorDir = path.join(root, 'desktop-plugins/word-peek/dev')
const mirrors = fs.readdirSync(sourceDir, {withFileTypes:true}).filter(entry => entry.isFile() && (entry.name === '.gitignore' || /\.(?:js|mjs|cjs|json|html)$/.test(entry.name))).map(entry => [path.join(sourceDir,entry.name),path.join(mirrorDir,entry.name)])
for (const directory of ['word-peek','desktop-plugins/word-peek','desktop']) mirrors.push([path.join(root,'README.md'),path.join(root,directory,'README.md')])
mirrors.push([path.join(root,'word-peek/THIRD-PARTY-NOTICES.txt'),path.join(root,'desktop-plugins/word-peek/THIRD-PARTY-NOTICES.txt')])
if (mode === '--release') for (const [source,target] of mirrors) {fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)}
if (mode === '--check') {
  const stale = releases.filter(file => !fs.existsSync(file) || !bundle.equals(fs.readFileSync(file)))
  const nativeNotice = path.join(root, 'desktop/THIRD-PARTY-NOTICES.txt')
  if (!fs.existsSync(nativeNotice) || !notice.equals(fs.readFileSync(nativeNotice))) stale.push(nativeNotice)
  for (const [source,target] of mirrors) if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) stale.push(target)
  if (stale.length) throw new Error('Release files are missing or stale. Run npm run release:\n' + stale.map(file => path.relative(root, file)).join('\n'))
  console.log('PASS all shipped bundles, source mirrors, documentation and notices match')
} else {
  const targets = mode === '--release' ? releases : [mode === '--install'
    ? path.join(process.env.HERMES_HOME, 'desktop-plugins/word-peek/plugin.js')
    : path.join(__dirname, 'dist/plugin.js')]
  for (const file of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bundle)
  }
  if (mode === '--release') fs.writeFileSync(path.join(root, 'desktop/THIRD-PARTY-NOTICES.txt'), notice)
}
