
const spawn = require('child_process').spawn;
const fs = require('fs');
const tcpportused = require('tcp-port-used');
const os = require('os'); 
const path = require('path');

//load config from local directory
const config = require(process.cwd()+'/config.json');

//statis config for now..
const minport=11000;
const maxport=12000;

console.log("starting setup");
console.dir(config);

const nvidia_dir = process.env.NVIDIA_DIR || '/usr/lib/nvidia-384';

//start docker container
//TODO validate config.input_instance_id
//TODO validate config.input_task_id
var src_path = '../../'+config.input_instance_id+'/'+config.input_task_id;
if(config.subdir) src_path += '/'+config.subdir;
var abs_src_path = path.resolve(src_path);

var container_name = null;
switch(config.type) {
case "fslview":
    container_name = "soichih/vncserver-fslview"; break;
case "fsleyes":
    container_name = "brainlife/ui-fsleyes"; break;
case "freeview":
    container_name = "soichih/vncserver-freeview"; break;
case "freeview-gpu":
    container_name = "soichih/vncserver-freeview-gpu"; break;
case "mrview":
    container_name = "soichih/vncserver-mrview"; break;
case "mricrogl":
    container_name = "soichih/vncserver-mricrogl"; break;
case "fibernavigator":
    container_name = "soichih/vncserver-fibernavigator"; break;
case "conn":
    container_name = "soichih/ui-conn"; break;
default:
    console.error("unknown container type", config.type);
}

const pull = spawn('docker', ['pull', container_name]); 
pull.stdout.on('data', (data)=>{
    console.log(data.toString());
});
pull.stderr.on('data', (data)=>{
    console.error(data.toString());
});
pull.on('close', (code)=>{
    if(code != 0) throw new Error("failed to pull container. code:"+ code);
    
    //create password for vncserver
    require('crypto').randomBytes(8, function(err, buffer) {
        const password = buffer.toString('hex');
        const cont = spawn('docker', ['run', '-dP',  
        '--runtime=nvidia',
		'-e', 'X11VNC_PASSWORD='+password, 
		'-e', 'LD_LIBRARY_PATH=/usr/lib/nvidia', 
		'-v', nvidia_dir+':/usr/lib/nvidia:ro',
		'-v', '/tmp/.X11-unix:/tmp/.X11-unix:ro',
		'-v', '/usr/local/licensed-bin:/usr/local/licensed-bin:ro',
		'-v', abs_src_path+':/input:ro', 
		container_name]); 
        var cont_id = "";
        cont.stdout.on('data', (data)=>{
            cont_id+=data.toString().trim();
        });
        cont.stderr.on('data', (data)=>{
            console.error(data.toString());
        });
        cont.on('close', (code)=>{
            if(code != 0) throw new Error("failed to start container. code:"+ code);
            console.log("container started",cont_id);
            fs.writeFileSync("cont.id", cont_id);
            //find host:port that container listens to
            const getp = spawn('docker', ['port', cont_id]);
            var rep = "";
            getp.stdout.on('data', (data)=>{
                rep += data.toString().trim();
            });
            getp.stderr.on('data', (data)=>{
                console.error(data.toString());
            });
            getp.on('close', (code)=>{
                if(code != 0) throw new Error("failed to get docker host/port");
                var hostport = rep.split(" ")[2];
                var vncport = parseInt(hostport.split(":")[1]);

                //wait for vnc server to become ready
                console.log("waiting for container.vncserver", vncport);
                tcpportused.waitUntilUsed(vncport, 200, 9000) //port, retry, timeout
                .then(()=>{
                
                    //find open port to use
                    tcpportused.findFree(11000, 12000, '0.0.0.0')
                    .then(port=>{
                        //start noVNC
                        const novnc_out = fs.openSync('./novnc.log', 'a');
                        const novnc_err = fs.openSync('./novnc.log', 'a');
                        console.log('running /usr/local/noVNC/utils/launch.sh', '--listen', port, '--vnc', hostport);
                        const novnc = spawn('/usr/local/noVNC/utils/launch.sh', ['--listen', port, '--vnc', hostport], {
                            detached: true, stdio: ['ignore', novnc_out, novnc_err]
                        });
                        novnc.unref();

                        tcpportused.waitUntilUsed(port, 200, 10*1000) //port, retry, timeout
                        .then(()=>{
                            console.log("started novnc", novnc.pid);
                            fs.writeFileSync("novnc.pid", novnc.pid);

                            var url = "http://"+os.hostname()+":"+port+"/vnc_lite.html?password="+password+"&reconnect=true&title=Brainlife";
                            fs.writeFileSync("url.txt", url);
                            console.log("all done", url);
                        }, err=>{
                            console.error("noNVC didn't start in 10sec");
			    throw err;
                        });
                    }, err=>{
                        console.error("can't find an open port for novnc");
                        throw err;
                    });
                }, err=>{
                    console.error("contianer.vncserver didn't become ready in 9sec");
                    throw err;
                });
            });
        });
    });
});


