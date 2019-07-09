var express = require('express');
var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var fs = require('fs');
var wget = require('node-wget');
var execSync = require('child_process').execSync;
var util = require('util');

var temp_zip_filename = './temp.zip';

var credentials_filename = "./deploy.cfg";
var username = "";
var password = "";
var appvdf = "";
var content_dir = "";
var steamcmd = "";

const port = process.env.port || 5000

process.on('uncaughtException', function (err) {
console.log(err); //Send some notification about the error
process.exit(1); });

app.post('/', function (req, res) {
  process_href(req.body.links.artifacts[0].files[0].href);
});

function process_href(href)
{
  remove_build(content_dir);
  create_directory(content_dir);
  wget({
	url: href, 
        dest: temp_zip_filename,
        timeout: 3600000       // 1 hour
    },
    wget_completed
  );
}

function wget_completed(error, response, body)
{
  if (error) {
    console.log(error);
  } else {
    decompress_build(temp_zip_filename, content_dir);
    steam_deploy();
    fs.unlinkSync(temp_zip_filename);
  }
}

function decompress_build(input_filename, output_path)
{
  console.log('Decompressing build...');
  try {
    execSync(`unzip -o ${temp_zip_filename} -d ${content_dir}`);
  } catch (error) {
    console.log('Unzip failed');
    process.exit(1);
  }
}

function steam_deploy()
{
  parse_config(credentials_filename);

  console.log('Uploading build to Steam...');
  try {
    execSync(`${steamcmd} +login ${username} ${password} +run_app_build ${appvdf} +quit`);
  } catch (error) {
    console.log('Upload failed');
    process.exit(1);
  }

  console.log('Upload complete');
}

function parse_config(filename)
{
  var data = fs.readFileSync(filename, 'utf8');
  var lines = data.split("\n");
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

function remove_build(path)
{
  delete_folder_recursive(path);
}

function delete_folder_recursive(path)
{
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + "/" + file;
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
  console.log("Listening on port %s", port);
});
