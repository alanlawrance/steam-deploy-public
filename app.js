let express = require('express');
let app = express();

let bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let fs = require('fs');
let request = require('request');
let https = require('https');
let execSync = require('child_process').execSync;
let util = require('util');
let path = require('path');

const port = process.env.port || 5000

process.on('uncaughtException', function (err) {
console.log(err);
process.exit(1); });

app.post('/', async(req, res) => {
  handleBuildSuccessEvent(req);
  res.json("Success");
});

async function handleBuildSuccessEvent(request) {
  let config_filename = request.body.buildTargetName;
  let build_number = request.body.buildNumber;
  let last_commit = request.body.lastBuiltRevision;
  let version = build_number.toString().concat('\n').concat(last_commit);
  let href = getArtifactHref(request);
  let configuration = tryToLoadConfigurationFile(config_filename)

  if (href != null && configuration != null) {
    remove_build(configuration.contentDir);
    create_directory(configuration.contentDir);

    let temp_zip_filename = './' + config_filename + '.zip';
    remove_file(temp_zip_filename);

    // need to delete previous output, as cached data from Steam uploads will grow unbounded
    // TODO: improvement would be to only delete once directory size exceeds threshold
    delete_folder_recursive(configuration.outputDir)
    
    download(configuration, href, temp_zip_filename, version, onDownloadCompleted); 
  } else {
    console.error(config_filename + " doesn't have a configuration file")
  }
}

function getArtifactHref(request) {
  try {
    let href = request.body.links.artifacts[0].files[0].href;
    // at some point Unity started putting the pdb_symbols href first in the artifacts list, so skip that if found
    if (href.includes('pdb_symbols')) {
      href = request.body.links.artifacts[1].files[0].href;
    }
    return href;
  } catch (e) {
    console.error("Unable to get artifact href for: " + e.message);
    return null;
  }
}

function tryToLoadConfigurationFile(config_filename) {
  if (fs.existsSync("./configuration/" + config_filename.concat('.yaml'))) {
    return {};
  } else if (fs.existsSync(config_filename.concat('.cfg'))) {
    return parseLegacyConfigurationFile(config_filename);
  }
  return null;
}

function parseLegacyConfigurationFile(config_filename)
{
  try {
    let data = fs.readFileSync(config_filename.concat('.cfg'), 'utf8');
    let lines = data.split('\n');
    return {
      username: lines[0].trim(),
      password: lines[1].trim(),
      contentDir: lines[2].trim(),
      outputDir: lines[3].trim(),
      steamcmd: lines[4].trim(),
      appvdf: lines[5].trim(),
      versionFilename: lines[6].trim(),
      steamAppidFilename: lines[7].trim(),
      steamDllFilename: lines[8].trim(),
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
    decompressBuild(dest, configuration.contentDir);
    createVersionFile(version, configuration.versionFilename);
    copySteamDllToBuild(configuration.steamDllFilename, configuration.contentDir);
    steamDeploy(configuration);
}

function decompressBuild(filename, contentDir)
{
  console.log('Decompressing build...');
  try {
    execSync(`unzip -o ${filename} -d ${contentDir}`);
  } catch (error) {
    console.log('Unzip failed with error %s', error.message);
    process.exit(1);
  }
}

function copySteamDllToBuild(steamDllFilename, contentDir)
{
  fs.copyFileSync(steamDllFilename, path.join(contentDir, path.basename(steamDllFilename)));
}

function createVersionFile(version, versionFilename)
{
  console.log('Write console log to %s', versionFilename);
  fs.writeFileSync(versionFilename, version); 
}

function steamDeploy(configuration)
{
  console.log('Uploading build to Steam...');
  try {
    execSync(`${configuration.steamcmd} +login ${configuration.username} '${configuration.password}' +run_app_build ${configuration.appvdf} +quit`);
  } catch (error) {
    console.log('Upload failed with error %s', error.message);
    process.exit(1);
  }

  console.log('Upload complete');
}

function create_directory(path)
{
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  }
}

function remove_file(path)
{
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

function remove_build(path)
{
  delete_folder_recursive(path);
}

function delete_folder_recursive(path)
{
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      let curPath = path + '/' + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        delete_folder_recursive(curPath);
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
