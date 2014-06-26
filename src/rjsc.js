#!/usr/bin/env node

var fs = require('fs');
var rjs = require('rjs');
var ws = require('ws');
var path = require('path');
var optimist = require('optimist');
var safe = require('safetydance');
var usageString = ('Usage:\n$0 ...options\n' +
                   '  -c|--compile [file]\n' +
                   '  -f|--follow-symbol [location]\n' +
                   '  -r|--find-references [location]\n' +
                   '  -F|--dump-file [file]\n' +
                   '  -d|--dump\n' +
                   '  -u|--cursor-info [location]\n' +
                   '  -N|--no-context\n' +
                   '  -v|--verbose\n' +
                   "  -D|--daemon\n" +
                   '  -p|--port [port] (default ' + rjs.defaultPort + ')\n');

optimist.usage(usageString);
optimist.default('port', rjs.defaultPort); // default not working?

var verbose = 0;
['v', 'verbose'].forEach(function(arg) {
    if (typeof optimist.argv[arg] === 'boolean') {
        ++verbose;
    } else if (optimist.argv[arg] instanceof Array) {
        verbose += optimist.argv[arg].length;
    }
});

var showContext = true;
var daemon = false;
['N', 'no-context'].forEach(function(arg) { if (optimist.argv[arg]) showContext = false; });
['D', 'daemon'].forEach(function(arg) { if (optimist.argv[arg]) daemon = true; });

// console.log(optimist.argv.port);
if (!optimist.argv.port)
    optimist.argv.port = rjs.defaultPort;

var compiles, followSymbols, references, dumps, cursorInfos;
function updateCommmands(argv)
{
    function values() {
        var ret = [];
        for (var i=0; i<arguments.length; ++i) {
            if (argv.hasOwnProperty(arguments[i])) {
                var val = argv[arguments[i]];
                if (val instanceof Array) {
                    ret = ret.concat(val);
                } else {
                    ret.push(val);
                }
            }
        }
        return ret;
    }
    compiles = values('c', 'compile');
    followSymbols = values('f', 'follow-symbol');
    references = values('r', 'find-references');
    dumps = values('F', 'dump-file');
    cursorInfos = values('u', 'cursor-info');
    ['d', 'dump'].forEach(function(arg) { if (argv[arg]) dumps.push(true); });
}
updateCommmands(optimist.argv);

if (!compiles.length && !followSymbols.length && !references.length
    && !dumps.length && !cursorInfos.length && !daemon) {
    console.error(usageString.replace("$0", __filename));
    process.exit(1);
}
if (daemon) {
    process.stdin.setEncoding('utf8');
    var pendingStdIn = "";
    process.stdin.on('readable', function() {
        pendingStdIn += process.stdin.read();
        var commands = pendingStdIn.split('\n');
        if (commands.length > 1) {
            for (var i=0; i<commands.length - 1; ++i) {


            }
            commands
        }
        console
        // if (chunk !== null) {
        //     process.stdout.write('data: ' + chunk);
        // }
    });

}
var sock;
var server = 'ws://localhost:' + optimist.argv.port + '/';
// console.log("server", server);
var lastFile;
var lastMessage;
function finish(code) {
    if (!daemon)
        process.exit(code);
}
function sendNext() {
    function send(obj) { lastMessage = obj; sock.send(JSON.stringify(obj)); }

    function createLocation(fileAndOffset) {
        var caps = /(.*),([0-9]+)?/.exec(fileAndOffset);
        // var caps = /(.*):([0-9]+):([0-9]+):?/.exec(fileAndLine);
        if (!caps) {
            console.error("Can't parse location", fileAndOffset);
            finish(7);
        }
        var stat = safe.fs.statSync(caps[1]);
        if (!stat || !stat.isFile()) {
            console.error(caps[1], "doesn't seem to be a file");
            finish(8);
        }
        lastFile = path.resolve(caps[1]);
        // return { file: caps[1], line: caps[2], column: caps[3] };
        return { file: lastFile, offset: caps[2] };
    }
    if (compiles.length) {
        var c = compiles.splice(0, 1)[0];
        var stat = safe.fs.statSync(c);
        if (!stat || !stat.isFile()) {
            console.error(c, 'does not seem to be a file');
            finish(4);
        }

        send({ type: rjs.MESSAGE_COMPILE, file: path.resolve(c) });
        return;
    }

    var location;
    if (followSymbols.length) {
        location = createLocation(followSymbols.splice(0, 1)[0]);
        send({ type: rjs.MESSAGE_FOLLOW_SYMBOL, location: location });
        return;
    }

    if (references.length) {
        location = createLocation(references.splice(0, 1)[0]);
        send({ type: rjs.MESSAGE_FIND_REFERENCES, location: location });
        return;
    }

    if (dumps.length) {
        var val = dumps.splice(0, 1)[0];
        var msg = { type: rjs.MESSAGE_DUMP };
        if (typeof val === 'string')
            msg.file = path.resolve(val);
        if (verbose) {
            console.log("calling dump with", msg, val);
        }

        send(msg);
        return;
    }

    if (cursorInfos.length) {
        location = createLocation(cursorInfos.splice(0, 1)[0]);
        send({ type: rjs.MESSAGE_CURSOR_INFO, location: location });
        return;
    }
    finish(0);
}
function initSocket()
{
    sock = new ws(server);
    sock.on('error', function(err) {
        if (err.errno === 'ECONNREFUSED') {
            // console.error("Can't seem to connect to server at", server, " Are you sure it's running?");
            // ### this is not working
            if (daemon) {
                setTimeout(initSocket, 1000);
            } else {
                finish(2);
            }
        }
    });
    sock.on('open', function() {
        sendNext();
    });
}
initSocket();

var fileCache = {};
sock.on('message', function(data) {
    var response = safe.JSON.parse(data);
    if (!response) {
        console.error("Invalid response", data);
        finish(5);
    }
    if (verbose && typeof response.error !== undefined)
        response.errorString = rjs.errorCodeToString(response.error);
    if (verbose)
        console.log("GOT RESPONSE", response);
    function printLocation(loc, header) {
        var out = (header || "") + lastFile + ',' + loc[0];
        if (showContext) {
            var contents = fileCache[lastFile];
            if (!contents) {
                contents = safe.fs.readFileSync(lastFile, { encoding: 'utf8' });
                if (contents) {
                    fileCache[lastFile] = contents;
                }
            }
            if (contents && contents.length > loc[0]) {
                var prevNewLine = contents.lastIndexOf('\n', loc[0]) + 1;
                var nextNewLine = contents.indexOf('\n', loc[0]);
                if (nextNewLine == -1)
                    nextNewLine = contents.length;
                out += '\t' + contents.substring(prevNewLine, nextNewLine - 1);
            }
        }
        console.log(out);
    }
    if (response.target) {
        printLocation(response.target);
    } else if (response.references) {
        response.references.forEach(function(ref) { printLocation(ref); });
    } else if (response.dump) {
        console.log(response.dump);
    } else if (response.cursorInfo) {
        printLocation(response.cursorInfo.location);
        console.log("Name:",
                    response.cursorInfo.name,
                    response.cursorInfo.definition ? "Definition" : "Reference");
        if (response.cursorInfo.references && response.cursorInfo.references.length) {
            console.log("References:");
            response.cursorInfo.references.forEach(function(loc) { printLocation(loc, "  "); });
        }
        // console.log(response.cursorInfo);
    }
    if (response.error != rjs.ERROR_MORE_DATA)
        sendNext();
});


