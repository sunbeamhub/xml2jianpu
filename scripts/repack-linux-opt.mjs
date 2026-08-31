#!/usr/bin/env node
/**
 * 把 Tauri 打出的 .deb / .rpm 收到 /opt/yipu，二进制与图标统一为 yipu。
 * 仅在 Linux 且本机有对应工具时执行。
 *
 *   node scripts/repack-linux-opt.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const targetRoot = path.join(root, 'src-tauri/target')

const OPT_BIN = '/opt/yipu/yipu'
const OPT_ICON = '/opt/yipu/yipu.png'

function hasCommand(name) {
  const r = spawnSync('which', [name], { encoding: 'utf8' })
  return r.status === 0
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim()
    throw new Error(`${cmd} ${args.join(' ')} 失败${detail ? `\n${detail}` : ''}`)
  }
  return r
}

function walkDirs(dir, visit) {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      visit(full, ent.name)
      walkDirs(full, visit)
    }
  }
}

function listFiles(dir, ext) {
  const out = []
  walkDirs(targetRoot, (full, name) => {
    if (name !== dir) return
    for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith(ext)) out.push(path.join(full, ent.name))
    }
  })
  return out
}

function isFinalBundle(fileName, ext) {
  return new RegExp(`^yipu_\\d+\\.\\d+\\.\\d+_linux_.+\\${ext}$`).test(fileName)
}

function rmYiPuLeftovers(parentDir) {
  if (!fs.existsSync(parentDir)) return
  for (const ent of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!ent.name.startsWith('易谱')) continue
    const full = path.join(parentDir, ent.name)
    fs.rmSync(full, { recursive: true, force: true })
    console.log(`repack-linux-opt: 删除旧产物 ${path.relative(root, full)}`)
  }
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walkFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

function findBinary(treeRoot) {
  const binDir = path.join(treeRoot, 'usr/bin')
  for (const name of ['yipu', 'xml2jianpu']) {
    const p = path.join(binDir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

function findPng(treeRoot) {
  const icons = walkFiles(path.join(treeRoot, 'usr/share/icons')).filter((f) => f.endsWith('.png'))
  if (icons.length === 0) return null
  const preferred = icons.find((f) => f.includes('128x128')) || icons.find((f) => f.includes('256x256'))
  return preferred || icons[0]
}

function findDesktop(treeRoot) {
  const apps = path.join(treeRoot, 'usr/share/applications')
  if (!fs.existsSync(apps)) return null
  const files = fs.readdirSync(apps).filter((n) => n.endsWith('.desktop'))
  if (files.length === 0) return null
  const preferred = files.find((n) => n === 'yipu.desktop') || files[0]
  return path.join(apps, preferred)
}

function patchDesktop(filePath) {
  let text = fs.readFileSync(filePath, 'utf8')
  text = text.replace(/^Exec=.*$/m, `Exec=${OPT_BIN}`)
  text = text.replace(/^Icon=.*$/m, `Icon=${OPT_ICON}`)
  if (/^StartupWMClass=/m.test(text)) {
    text = text.replace(/^StartupWMClass=.*$/m, 'StartupWMClass=yipu')
  } else {
    text = text.replace(/^Exec=.*$/m, (line) => `${line}\nStartupWMClass=yipu`)
  }
  fs.writeFileSync(filePath, text)
}

function layoutToOpt(treeRoot) {
  const binary = findBinary(treeRoot)
  if (!binary) throw new Error(`未找到可执行文件: ${treeRoot}`)
  const png = findPng(treeRoot)
  const desktop = findDesktop(treeRoot)
  if (!desktop) throw new Error(`未找到 .desktop: ${treeRoot}`)

  const optDir = path.join(treeRoot, 'opt/yipu')
  fs.mkdirSync(optDir, { recursive: true })
  const destBin = path.join(optDir, 'yipu')
  if (path.resolve(binary) !== path.resolve(destBin)) {
    fs.renameSync(binary, destBin)
  }
  fs.chmodSync(destBin, 0o755)

  if (png) {
    fs.copyFileSync(png, path.join(optDir, 'yipu.png'))
  }
  fs.rmSync(path.join(treeRoot, 'usr/share/icons'), { recursive: true, force: true })
  fs.rmSync(path.join(treeRoot, 'usr/bin'), { recursive: true, force: true })
  fs.rmSync(path.join(treeRoot, 'usr/lib'), { recursive: true, force: true })

  const destDesktop = path.join(treeRoot, 'usr/share/applications/yipu.desktop')
  if (path.resolve(desktop) !== path.resolve(destDesktop)) {
    fs.mkdirSync(path.dirname(destDesktop), { recursive: true })
    fs.renameSync(desktop, destDesktop)
  }
  patchDesktop(destDesktop)
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function patchDebControl(controlPath) {
  if (!fs.existsSync(controlPath)) return
  let text = fs.readFileSync(controlPath, 'utf8')
  text = text.replace(/^Package:.*$/m, 'Package: yipu')
  fs.writeFileSync(controlPath, text)
}

function repackDeb(debPath) {
  const work = tmpDir('yipu-deb-')
  try {
    run('dpkg-deb', ['-R', debPath, work])
    patchDebControl(path.join(work, 'DEBIAN/control'))
    layoutToOpt(work)
    const built = path.join(path.dirname(debPath), `.repack-${path.basename(debPath)}`)
    run('dpkg-deb', ['-b', work, built])
    fs.renameSync(built, debPath)
    console.log(`repack-linux-opt: deb ${path.relative(root, debPath)} → /opt/yipu`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function rpmQuery(rpmPath, format) {
  const r = run('rpm', ['-qp', '--queryformat', format, rpmPath])
  return (r.stdout || '').trim()
}

function rpmRequires(rpmPath) {
  const r = run('rpm', ['-qp', '--requires', rpmPath])
  return (r.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('rpmlib('))
}

function writeSpec({ specPath, name, ver, release, summary, license, requires, files }) {
  const reqLines = requires.map((d) => `Requires: ${d}`).join('\n')
  const fileLines = files.join('\n')
  const spec = `Name: ${name}
Version: ${ver}
Release: ${release}
Summary: ${summary || name}
License: ${license || 'unknown'}
AutoReqProv: no
${reqLines}

%define debug_package %{nil}
%define _build_id_links none

%description
${summary || name}

%prep

%build

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -a %{_topdir}/payload/. %{buildroot}/

%files
${fileLines}
`
  fs.writeFileSync(specPath, spec)
}

function repackRpm(rpmPath) {
  const extract = tmpDir('yipu-rpm-extract-')
  const topdir = tmpDir('yipu-rpm-build-')
  try {
    run('sh', ['-c', `rpm2cpio ${JSON.stringify(rpmPath)} | cpio -idmu --quiet`], {
      cwd: extract,
    })
    layoutToOpt(extract)

    const name = 'yipu'
    const ver = rpmQuery(rpmPath, '%{VERSION}') || version
    const release = rpmQuery(rpmPath, '%{RELEASE}') || '1'
    const arch = rpmQuery(rpmPath, '%{ARCH}') || 'x86_64'
    const summary = rpmQuery(rpmPath, '%{SUMMARY}') || '易谱'
    const license = rpmQuery(rpmPath, '%{LICENSE}') || 'unknown'
    const requires = rpmRequires(rpmPath)

    const payload = path.join(topdir, 'payload')
    fs.mkdirSync(payload, { recursive: true })
    for (const sub of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS']) {
      fs.mkdirSync(path.join(topdir, sub), { recursive: true })
    }

    const files = []
    for (const rel of ['opt/yipu/yipu', 'opt/yipu/yipu.png', 'usr/share/applications/yipu.desktop']) {
      const src = path.join(extract, rel)
      if (!fs.existsSync(src)) continue
      const dest = path.join(payload, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      if (rel.endsWith('/yipu')) fs.chmodSync(dest, 0o755)
      files.push(`/${rel}`)
    }

    const specPath = path.join(topdir, 'SPECS/yipu.spec')
    writeSpec({
      specPath,
      name,
      ver,
      release,
      summary,
      license,
      requires,
      files,
    })

    run('rpmbuild', [
      '-bb',
      '--nocheck',
      '--target',
      arch,
      '--define',
      `_topdir ${topdir}`,
      specPath,
    ])

    const rpmsDir = path.join(topdir, 'RPMS', arch)
    const built = fs.existsSync(rpmsDir)
      ? fs.readdirSync(rpmsDir).find((n) => n.endsWith('.rpm'))
      : null
    if (!built) throw new Error('rpmbuild 未产出 rpm')
    fs.copyFileSync(path.join(rpmsDir, built), rpmPath)
    console.log(`repack-linux-opt: rpm ${path.relative(root, rpmPath)} → /opt/yipu`)
  } finally {
    fs.rmSync(extract, { recursive: true, force: true })
    fs.rmSync(topdir, { recursive: true, force: true })
  }
}

if (process.platform !== 'linux') {
  console.log('repack-linux-opt: 非 Linux，跳过')
  process.exit(0)
}

for (const dirName of ['deb', 'rpm']) {
  walkDirs(targetRoot, (full, name) => {
    if (name === dirName) rmYiPuLeftovers(full)
  })
}

const debs = listFiles('deb', '.deb').filter((p) => !isFinalBundle(path.basename(p), '.deb'))
const rpms = listFiles('rpm', '.rpm').filter((p) => !isFinalBundle(path.basename(p), '.rpm'))

if (debs.length && !hasCommand('dpkg-deb')) {
  console.log('repack-linux-opt: 未找到 dpkg-deb，跳过 deb')
} else {
  for (const deb of debs) repackDeb(deb)
}

if (rpms.length && !(hasCommand('rpm') && hasCommand('rpm2cpio') && hasCommand('rpmbuild') && hasCommand('cpio'))) {
  console.log('repack-linux-opt: 未找到 rpm/rpm2cpio/rpmbuild/cpio，跳过 rpm')
} else {
  for (const rpm of rpms) repackRpm(rpm)
}

console.log('repack-linux-opt: 完成')
