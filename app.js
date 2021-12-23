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

let temp_zip_filename = './temp.zip';

let username = "";
let password = "";
let appvdf = "";
let content_dir = "";
let output_dir = "";
let steamcmd = "";
let version_filename = "";
let steam_appid_filename = "";
let steam_dll_filename = "";

const port = process.env.port || 5000

process.on('uncaughtException', function (err) {
console.log(err);
process.exit(1); });

app.post('/', async(req, res, next) => {
  let config_filename = req.body.buildTargetName.concat('.cfg');
  let build_number = req.body.buildNumber;
  let last_commit = req.body.lastBuiltRevision;
  let version = build_number.toString().concat('\n').concat(last_commit);
  if (fs.existsSync(config_filename)) {
      parse_config(config_filename);

      // at some point Unity started putting the pdb_symbols href first in the artifacts list, so skip that if found
      let href = req.body.links.artifacts[0].files[0].href;
      if (href.includes('pdb_symbols')) {
          href = req.body.links.artifacts[1].files[0].href;
  }
  process_href(href, version);
  res.json("Success")
  } else {
    next(config_filename + ' not found so Build Success Event ignored')
  }
});

function process_href(href, version)
{
  remove_build(content_dir);
  create_directory(content_dir);
  remove_file(temp_zip_filename);

  // need to delete previous output, as cached data from Steam uploads will grow unbounded
  // TODO: improvement would be to only delete once directory size exceeds threshold
  delete_folder_recursive(output_dir)
  
  download(href, temp_zip_filename, version, download_completed); 
}

function download(url, dest, version, cb)
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
    cb(dest, version);
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

function download_completed(dest, version)
{
    decompress_build(dest, content_dir);
    create_version_file(version);
    copy_steam_dll_to_build();
    steam_deploy();
}

function decompress_build(filename, output_path)
{
  console.log('Decompressing build...');
  try {
    execSync(`unzip -o ${filename} -d ${content_dir}`);
  } catch (error) {
    console.log('Unzip failed with error %s', error.message);
    process.exit(1);
  }
}

function copy_steam_dll_to_build()
{
  fs.copyFileSync(steam_dll_filename, path.join(content_dir, path.basename(steam_dll_filename)));
}

function create_version_file(version)
{
  console.log('Write console log to %s', version_filename);
  fs.writeFileSync(version_filename, version); 
}

function steam_deploy()
{
  console.log('Uploading build to Steam...');
  try {
    execSync(`${steamcmd} +login ${username} '${password}' +run_app_build ${appvdf} +quit`);
  } catch (error) {
    console.log('Upload failed with error %s', error.message);
    process.exit(1);
  }

  console.log('Upload complete');
}

function parse_config(filename)
{
  let data = fs.readFileSync(filename, 'utf8');
  let lines = data.split('\n');
  username = lines[0].trim();
  password = lines[1].trim();
  content_dir = lines[2].trim();
  output_dir  = lines[3].trim();
  steamcmd = lines[4].trim();
  appvdf = lines[5].trim();
  version_filename = lines[6].trim();
  steam_appid_filename = lines[7].trim();
  steam_dll_filename = lines[8].trim();
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
