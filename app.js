var express = require('express');
var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var fs = require('fs');
var https = require('https');
var execSync = require('child_process').execSync;
var util = require('util');

var temp_zip_filename = './temp.zip';

var username = "";
var password = "";
var appvdf = "";
var content_dir = "";
var steamcmd = "";

const port = process.env.port || 5000

process.on('uncaughtException', function (err) {
console.log(err);
process.exit(1); });

app.post('/', function (req, res) {
  var config_filename = req.body.buildTargetName.concat('.cfg');
  if (fs.existsSync(config_filename)) {
    parse_config(config_filename);
    process_href(req.body.links.artifacts[0].files[0].href);
  } else {
    console.log('%s not found so Build Success Event ignored', config_filename);
  }
});

function process_href(href)
{
  remove_build(content_dir);
  create_directory(content_dir);
  remove_file(temp_zip_filename);
  download_href(href, temp_zip_filename); 
}

function download_href(url, dest)
{
  try {
    var file = fs.createWriteStream(dest);
  } catch(error) {
    console.log('Create %s failed with error %s', dest, error.message);
    process.exit(1);
  }

  https.get(url, function(res) {
    res.on('data', function(data) {
      file.write(data);
    }).on('end', function() {
      console.log('Downloaded build to %s', dest);
      file.end();
      download_completed(dest);
    });
  });
}

function download_completed(dest)
{
  if (error) {
    console.log(error);
  } else {
    decompress_build(dest, content_dir);
    steam_deploy();
  }
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

function steam_deploy()
{
  console.log('Uploading build to Steam...');
  try {
    execSync(`${steamcmd} +login ${username} ${password} +run_app_build ${appvdf} +quit`);
  } catch (error) {
    console.log('Upload failed with error %s', error.message);
    process.exit(1);
  }

  console.log('Upload complete');
}

function parse_config(filename)
{
  var data = fs.readFileSync(filename, 'utf8');
  var lines = data.split('\n');
  username = lines[0].trim();
  password = lines[1].trim();
  content_dir = lines[2].trim();
  steamcmd = lines[3].trim();
  appvdf = lines[4].trim();
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
      var curPath = path + '/' + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
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
