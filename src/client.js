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
                   '  -p|--port [port] (default ' + rjs.defaultPort + ')\n');
optimist.usage(usageString);
optimist.default('port', rjs.defaultPort); // default not working?
// console.log(optimist.argv.port);
if (!optimist.argv.port)
    optimist.argv.port = rjs.defaultPort;

var valid = false;
function values() {
    var ret = [];
    for (var i=0; i<arguments.length; ++i) {
        var val = optimist.argv[arguments[i]];
        if (typeof val === 'string') {
            ret.push(val);
            valid = true;
        } else if (val instanceof Array) {
            ret = ret.concat(val);
            valid = true;
        }
    }
    return ret;
}
var compiles = values('c', 'compile');
var followSymbols = values('f', 'follow-symbol');
var references = values('r', 'find-references');
if (!valid) {
    console.error(usageString.replace("$0", __filename));
    process.exit(1);
}
var sock;
var server = 'ws://localhost:' + optimist.argv.port + '/';
// console.log("server", server);
function sendNext() {
    function createLocation(fileAndLine) {
        var caps = /(.*):([0-9]+):([0-9]+):?/.exec(fileAndLine);
        if (!caps) {
            console.error("Can't parse location", fileAndLine);
            process.exit(7);
        }
        return { file: caps[1], line: caps[2], column: caps[3] };
    }
    if (compiles.length) {
        var c = compiles.splice(0, 1)[0];
        var stat = safe.fs.statSync(c);
        if (!stat || !stat.isFile()) {
            console.error(c, 'does not seem to be a file');
            process.exit(4);
        }

        sock.send(JSON.stringify({ type: rjs.MESSAGE_COMPILE, file: path.resolve(c) }));
        return;
    }

    var location;
    if (followSymbols.length) {
        location = createLocation(followSymbols.splice(0, 1)[0]);
        sock.send(JSON.stringify({ type: rjs.MESSAGE_FOLLOW_SYMBOL, location: location }));
        return;
    }

    if (references.length) {
        location = createLocation(followSymbols.splice(0, 1)[0]);
        sock.send(JSON.stringify({ type: rjs.MESSAGE_FIND_REFERENCES, location: location }));
        return;
    }
    process.exit(0);
}
try {
    sock = new ws(server);
    sock.on('open', function() {
        sendNext();
    });
    sock.on('message', function(data) {
        var response = safe.JSON.parse(data);
        if (!response) {
            console.error("Invalid response", data);
            process.exit(5);
        }
        console.log("GOT RESPONSE", response);
        sendNext();
        // flags.binary will be set if a binary data is received
        // flags.masked will be set if the data was masked
    });
} catch (err) {
    console.error("Can't seem to connect to server at", server, " Are you sure it's running?");
    process.exit(2);
}
// console.log(optimist.argv);
// if (
// if (typeof optimist.argv.c === 'undefined')
//     }
// console.log(optimist['-c']);
// for (var i=2; i<process.argv.length; ++i) {
//     switch (process.argv[i]) {
//     case '-c':
//     case '--compile':

//     }
// }
