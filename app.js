const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const request = require('request');
const https = require('https');
const execSync = require('child_process').execSync;
const util = require('util');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config()
const app = express();
const port = process.env.port || 5000

process.on('uncaughtException', function (err) {
  console.error(err);
  process.exit(1); 
});

app.use(express.json({type: "application/json", verify: function(req, res, buf, encoding) {
  req.headers['signature-verified'] = true;
  if("UNITY_CLOUD_BUILD_SIGNATURE" in process.env) {
    try {
      const hmacXCloudSignature = req.get('x-unitycloudbuild-signature');
  
      var digest = crypto
      .createHmac('SHA256', process.env.UNITY_CLOUD_BUILD_SIGNATURE)
      .update(buf)
      .digest('hex');
  
      if(digest != hmacXCloudSignature){
          req.headers['signature-verified'] = false;
      };
    } catch (e) {
      console.error("Error while trying to read signature of request: " + e.message);
      req.headers['signature-verified'] = false;
    }
  }
}}));
app.use(express.urlencoded({ extended: true }));


// Webhooks
app.post("/", async (req, res) => {
  const signatureCheckResult = req.get('signature-verified');
  if(signatureCheckResult) {
    console.log("Handling a request with valid signature");
    handleBuildSuccessEvent(req.body);
    res.status(200).send("OK");
  } else {
    console.log("Refusing a request with invalid signature");
    res.status(301).send("NOT OK");
  }
});

async function handleBuildSuccessEvent(body) {
  let config_filename = body.buildTargetName;
  let build_number = body.buildNumber;
  let last_commit = body.lastBuiltRevision;
  let version = build_number.toString().concat('\n').concat(last_commit);
  let href = getArtifactHref(body);
  let configuration = tryToLoadConfigurationFile(config_filename);

  if (href != null && configuration != null) {
    createDirectory(configuration.inputDir);
    let temp_zip_filename = './' + config_filename + '.zip';
    download(configuration, href, temp_zip_filename, version, onDownloadCompleted); 
  } else {
    console.error(config_filename + " doesn't have a configuration file")
  }
}

function getArtifactHref(body) {
  try {
	let buildZipFilename = body.buildTargetName + '-' + body.buildNumber + '.zip';
	for (let i = 0; i < body.links.artifacts.length; i++) {
		for (let j = 0; j < body.links.artifacts[i].files.length; j++) {
			if (body.links.artifacts[i].files[j].href.includes(buildZipFilename)) {
				return body.links.artifacts[i].files[j].href;
			}
		}
	}
	
    console.error('Unable to find artifact for build.  Artifacts present:');
	for (let i = 0; i < body.links.artifacts.length; i++) {
		for (let j = 0; j < body.links.artifacts[i].files.length; j++) {
			console.error(body.links.artifacts[i].files[j].filename);
		}
	}
	return null;
	
  } catch (e) {
    console.error("Unable to get artifact href due to exception: " + e.message);
    return null;
  }
}

function tryToLoadConfigurationFile(config_filename) {
  if (fs.existsSync("./build/" + config_filename.concat('.yml'))) {
    return parseConfigurationFile(config_filename);
  } else if (fs.existsSync(config_filename.concat('.cfg'))) {
    return parseLegacyConfigurationFile(config_filename);
  }
  return null;
}

function parseConfigurationFile(config_filename) {
  try {
    let configuration = yaml.load(fs.readFileSync("./build/" + config_filename.concat('.yml'), 'utf8'));
  
    configuration.inputDir = "build/" + config_filename + "/content";
    configuration.outputDir = "build/" + config_filename + "/output";
    configuration.versionFilename = configuration.inputDir + "/version.txt";
    configuration.steamDllFilename = configuration.inputDir + "/" + configuration.steamDllFilename;
    configuration.steamBuildConfigurationPath = configuration.steamBuilderPath + "/build/" + config_filename + "/" + configuration.steamBuildConfigurationPath;
    configuration.execForDRM = configuration.steamBuilderPath + "/" + configuration.inputDir + "/" + configuration.execForDRM;

    return configuration;
  } catch (e) {
    console.error("Something went wrong while trying to read a file: " + e.message);
    return null;
  }
}

function parseLegacyConfigurationFile(config_filename) {
  try {
    console.warn("Using legacy configuration file, go to the library website to update to the latest version")
    let data = fs.readFileSync(config_filename.concat('.cfg'), 'utf8');
    let lines = data.split('\n');
    return {
      username: lines[0].trim(),
      password: lines[1].trim(),
      inputDir: lines[2].trim(),
      outputDir: lines[3].trim(),
      steamcmdPath: lines[4].trim(),
      steamBuildConfigurationPath: lines[5].trim(),
      versionFilename: lines[6].trim(),
      steamAppidFilename: lines[7].trim(),
      steamDllFilename: lines[8].trim(),
      useDRM: false
    }
  } catch (e) {
    console.error("Something went wrong while trying to read a file: " + e.message);
    return null;
  }
}

function download(configuration, url, dest, version, cb)
{
  const file = fs.createWriteStream(dest);
  const sendReq = request.get(url);

  sendReq.on('response', (response) => {
    if (response.statusCode !== 200) {
      console.log('Error: Response status was ' + response.statusCode);
      return;
    }

     sendReq.pipe(file);
  });

  file.on('finish', () => {
    cb(configuration, dest, version);
    return;
  });

  sendReq.on('error', (err) => {
    console.log("Error: %s", err.message);
    fs.unlink(dest);
    return;
  });

  file.on('error', (err) => {
    console.log('Error: %s', err.message);
    fs.unlink(dest);
    return;
  });
};

function onDownloadCompleted(configuration, dest, version)
{
  try {
    decompressBuild(dest, configuration.inputDir);
    createVersionFile(version, configuration.versionFilename);
    copySteamDllToBuild(configuration.steamDllFilename, configuration.inputDir);
    steamDeploy(configuration);
  } catch (e) {
    console.error("Unable to manage steam upload for: " + e.message);
  } finally {
    if(process.env.NODE_ENV == "development") return;
    removeBuild(configuration.inputDir);
    removeBuild(configuration.outputDir);
    tryToRemoveTempFile(dest);
  }
}

function decompressBuild(filename, inputDir)
{
  console.log('Decompressing build...');
  try {
    execSync(`unzip -o ${filename} -d ${inputDir} -x "*.pdb" "*_BurstDebugInformation_DoNotShip/*" "*_BackUpThisFolder_ButDontShipItWithYourGame/*"`);
  } catch (error) {
    throw new Error('Unzip failed with error %s', error.message);
  }
}

function copySteamDllToBuild(steamDllFilename, inputDir)
{
  fs.copyFileSync(steamDllFilename, path.join(inputDir, path.basename(steamDllFilename)));
}

function createVersionFile(version, versionFilename)
{
  console.log('Write console log to %s', versionFilename);
  fs.writeFileSync(versionFilename, version); 
}

function steamDeploy(configuration)
{
  try {
    if(configuration.useDRM) {
      console.log('Uploading build to Steam with DRM...');
      execSync(`${configuration.steamcmdPath} +login ${configuration.username} '${configuration.password}' +drm_wrap ${configuration.appId} ${configuration.execForDRM} ${configuration.execForDRM} drmtoolp ${configuration.DRMType} +run_app_build ${configuration.steamBuildConfigurationPath} +quit`);
    } else {
      console.log('Uploading build to Steam without DRM...');
      execSync(`${configuration.steamcmdPath} +login ${configuration.username} '${configuration.password}' +run_app_build ${configuration.steamBuildConfigurationPath} +quit`);
    }
  } catch (error) {
    throw new Error('Upload failed with error %s', error.message);
  }
  console.log('Upload complete');
}

function createDirectory(path)
{
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

function tryToRemoveTempFile(path)
{
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

function removeBuild(path)
{
  deleteFolderRecursive(path);
}

function deleteFolderRecursive(path)
{
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      let curPath = path + '/' + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

app.listen(port, function () {
  console.log('Listening on port %s', port);
});
