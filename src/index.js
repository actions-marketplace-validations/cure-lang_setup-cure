import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as io from '@actions/io';
import { HttpClient } from '@actions/http-client';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function getLatestVersion(token) {
  const http = new HttpClient('setup-cure-action');
  const headers = {};
  if (token) {
    headers['Authorization'] = `token ${token}`;
    headers['User-Agent'] = 'setup-cure-action';
  }

  try {
    const res = await http.getJson('https://api.github.com/repos/cure-lang/cure-lang/tags', headers);
    if (res.statusCode === 200 && Array.isArray(res.result) && res.result.length > 0) {
      const tags = res.result.map(t => t.name).filter(Boolean);
      const semverTags = tags.filter(t => /^v?\d+\.\d+\.\d+/.test(t));
      if (semverTags.length > 0) {
        semverTags.sort((a, b) => {
          const vA = a.replace(/^v/, '').split('.').map(Number);
          const vB = b.replace(/^v/, '').split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if ((vA[i] || 0) > (vB[i] || 0)) return -1;
            if ((vA[i] || 0) < (vB[i] || 0)) return 1;
          }
          return 0;
        });
        return semverTags[0];
      }
    }
  } catch (err) {
    core.warning(`Failed to fetch tags from GitHub API: ${err.message}`);
  }

  return 'v0.34.1';
}

async function resolveVersion(inputVersion, token) {
  let v = inputVersion.trim();
  if (!v || v === 'latest') {
    return await getLatestVersion(token);
  }
  if (/^\d+\.\d+\.\d+/.test(v)) {
    return `v${v}`;
  }
  return v;
}

async function run() {
  try {
    const inputVersion = core.getInput('version') || core.getInput('cure-version') || 'latest';
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
    const useCache = core.getBooleanInput('cache');

    core.info(`Resolving Cure version: ${inputVersion}`);
    const tag = await resolveVersion(inputVersion, token);
    const cleanVersion = tag.replace(/^v/, '');
    const arch = os.arch();
    const platform = os.platform();

    core.info(`Resolved version tag: ${tag} (clean: ${cleanVersion})`);

    let cachedDir = '';
    if (useCache) {
      cachedDir = tc.find('cure', cleanVersion, arch);
    }

    if (cachedDir) {
      core.info(`Found Cure ${cleanVersion} in tool cache at ${cachedDir}`);
      core.setOutput('cache-hit', 'true');
    } else {
      core.info(`Cure ${cleanVersion} not found in tool cache. Preparing installation...`);
      core.setOutput('cache-hit', 'false');

      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'setup-cure-'));
      let installedPath = '';

      // 1. Try prebuilt release binary assets
      const assetNames = [
        `cure-${tag}-${platform}-${arch}.tar.gz`,
        `cure-${cleanVersion}-${platform}-${arch}.tar.gz`,
        `cure-${platform}-${arch}.tar.gz`,
        `cure-${tag}.tar.gz`,
        `cure-${cleanVersion}.tar.gz`
      ];

      for (const assetName of assetNames) {
        const downloadUrl = `https://github.com/cure-lang/cure-lang/releases/download/${tag}/${assetName}`;
        try {
          core.info(`Attempting download from: ${downloadUrl}`);
          const downloadedArchive = await tc.downloadTool(downloadUrl);
          if (downloadedArchive) {
            core.info(`Successfully downloaded prebuilt release asset: ${assetName}`);
            const extracted = await tc.extractTar(downloadedArchive, tempDir);
            installedPath = extracted;
            break;
          }
        } catch (e) {
          // Asset not found, continue to next candidate
        }
      }

      // 2. Fallback to building from source if prebuilt release binary asset is not available
      if (!installedPath || !fs.existsSync(path.join(installedPath, 'cure'))) {
        core.info(`No prebuilt release asset found for ${tag}. Building Cure from source archive...`);

        const sourceUrl = `https://github.com/cure-lang/cure-lang/archive/refs/tags/${tag}.tar.gz`;
        core.info(`Downloading source tarball from ${sourceUrl}`);
        const sourceArchive = await tc.downloadTool(sourceUrl);
        const sourceDir = await tc.extractTar(sourceArchive, tempDir);

        const subdirs = fs.readdirSync(sourceDir);
        const actualSourceDir = subdirs.length === 1 && fs.statSync(path.join(sourceDir, subdirs[0])).isDirectory()
          ? path.join(sourceDir, subdirs[0])
          : sourceDir;

        core.info(`Compiling Cure in ${actualSourceDir}...`);

        await exec.exec('mix', ['local.hex', '--force'], { cwd: actualSourceDir });
        await exec.exec('mix', ['local.rebar', '--force'], { cwd: actualSourceDir });
        await exec.exec('mix', ['deps.get'], { cwd: actualSourceDir });
        await exec.exec('mix', ['compile'], { cwd: actualSourceDir });

        const cureEscriptPath = path.join(actualSourceDir, 'cure');
        if (!fs.existsSync(cureEscriptPath)) {
          throw new Error(`Build failed: executable not found at ${cureEscriptPath}`);
        }

        installedPath = actualSourceDir;
      }

      const installDir = path.join(tempDir, 'installed');
      const binDir = path.join(installDir, 'bin');
      await io.mkdirP(binDir);

      const cureSourceBinary = fs.existsSync(path.join(installedPath, 'cure'))
        ? path.join(installedPath, 'cure')
        : path.join(installedPath, 'bin', 'cure');

      const targetBinary = path.join(binDir, 'cure');
      await io.cp(cureSourceBinary, targetBinary);
      await exec.exec('chmod', ['+x', targetBinary]);

      await io.cp(cureSourceBinary, path.join(installDir, 'cure'));
      await exec.exec('chmod', ['+x', path.join(installDir, 'cure')]);

      const privSource = path.join(installedPath, 'priv');
      if (fs.existsSync(privSource)) {
        await io.cp(privSource, path.join(installDir, 'priv'), { recursive: true });
      }

      const libSource = path.join(installedPath, 'lib');
      if (fs.existsSync(libSource)) {
        await io.cp(libSource, path.join(installDir, 'lib'), { recursive: true });
      }

      if (useCache) {
        cachedDir = await tc.cacheDir(installDir, 'cure', cleanVersion, arch);
        core.info(`Cached Cure ${cleanVersion} to ${cachedDir}`);
      } else {
        cachedDir = installDir;
      }
    }

    const finalBinDir = fs.existsSync(path.join(cachedDir, 'bin'))
      ? path.join(cachedDir, 'bin')
      : cachedDir;

    core.addPath(finalBinDir);

    core.exportVariable('CURE_HOME', cachedDir);
    const privEbin = path.join(cachedDir, 'priv', 'ebin');
    if (fs.existsSync(privEbin)) {
      core.exportVariable('CURE_LIB', privEbin);
    }
    core.exportVariable('CURE_VERSION', cleanVersion);

    core.setOutput('cure-version', cleanVersion);
    core.setOutput('cure-path', finalBinDir);

    core.info(`Cure ${cleanVersion} set up successfully!`);
    core.info(`Executable location: ${path.join(finalBinDir, 'cure')}`);
    core.info(`CURE_HOME set to: ${cachedDir}`);
  } catch (error) {
    core.setFailed(`setup-cure failed: ${error.message}`);
  }
}

run();
