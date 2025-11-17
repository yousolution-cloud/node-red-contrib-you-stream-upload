const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
const tempDir = path.join(projectRoot, 'temp_install');

try {
  // 1️⃣ Crea pacchetto npm
  console.log('Packing npm package...');
  const tgzFile = execSync('npm pack', {
    cwd: projectRoot,
    encoding: 'utf-8',
  }).trim();
  console.log(`Generated package: ${tgzFile}`);

  // 2️⃣ Rimuove eventuali vecchie installazioni temporanee
  if (fs.existsSync(tempDir)) {
    console.log('Removing old temp_install...');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 3️⃣ Installa pacchetto in temp_install
  console.log('Installing package in temporary folder...');
  execSync(
    `npm install "${path.join(projectRoot, tgzFile)}" --prefix "${tempDir}"`,
    { stdio: 'inherit' }
  );

  // 4️⃣ Copia solo il pacchetto installato in data/node_modules
  const pkgName = require(path.join(projectRoot, 'package.json')).name;
  const srcPkgDir = path.join(tempDir, 'node_modules', pkgName);
  const destNodeModules = path.join(dataDir, 'node_modules');

  if (fs.existsSync(destNodeModules)) {
    console.log('Removing old node_modules in data...');
    fs.rmSync(destNodeModules, { recursive: true, force: true });
  }

  fs.mkdirSync(destNodeModules, { recursive: true });

  console.log('Copying package to data folder...');
  // Copia ricorsiva
  const copyRecursiveSync = (src, dest) => {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      fs.readdirSync(src).forEach((child) => {
        copyRecursiveSync(path.join(src, child), path.join(dest, child));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  };
  copyRecursiveSync(srcPkgDir, path.join(destNodeModules, pkgName));

  // 5️⃣ Pulizia file temporanei
  console.log('Cleaning up temporary files...');
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.unlinkSync(path.join(projectRoot, tgzFile));

  // 6️⃣ Riavvia Docker
  console.log('Restarting Docker...');
  execSync('docker-compose restart', { stdio: 'inherit' });

  console.log('Update completed successfully!');
} catch (err) {
  console.error('Error during update:', err);
  process.exit(1);
}
