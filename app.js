var express = require('express');
var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var fs = require('fs');
var wget = require('node-wget');
var unzipper = require('unzipper');
var execSync = require('child_process').execSync;

var content_dir = '../build/content';
var temp_zip_filename = './temp.zip';

var credentials_filename = "./deploy.cfg";
var username = "";
var password = "";
var appvdf = "";

const port = process.env.port || 5000

app.post('/', function (req, res) {
  console.log('Processing POST message...');
  for (var artifact in req.body.links.artifacts) {
    if (artifact.key == "primary") {
      console.log("Processing href...");
      process_href(artifact.files[0].href);
    }
  }
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
  console.log("steam-deploy listening on port %s", port);
}

function decompress_build(input_filename, output_path)
{
  console.log('Decompressing build...');
  fs.createReadStream(input_filename).pipe(unzipper.Extract({ path: output_path }));  
}

function steam_deploy()
{
  console.log('Parsing credentials from deploy.cfg');
  parse_credentials(credentials_filename);

  console.log('Uploading build to Steam...');
  if (os.platform() == "win32") {
    execSync("..\\steamcmd\\steamcmd.exe +login ${username} ${password} +run_app_build ..\\build\\${appvdf} +quit");
  } else {
    execSync("../steamcmd/steamcmd.sh +login ${username} ${password} +run_app_build ../build/${appvdf} +quit");
  }
  console.log('Upload complete');
}

function parse_credentials(filename)
{
  var data = fs.readFileSync(filename, 'utf8');
  var lines = data.split("\n");
  username = lines[0];
  password = lines[1];
  appvdf = lines[2];
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
  console.log("steam-deploy listening on port %s", port);
});
