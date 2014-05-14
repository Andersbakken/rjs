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
                   '  -D|--dump-file [file]\n' +
                   '  -d|--dump\n' +
                   '  -N|--no-context\n' +
                   '  -v|--verbose\n' +
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
['N', 'no-context'].forEach(function(arg) { if (optimist.argv[arg]) showContext = false; });

// console.log(optimist.argv.port);
if (!optimist.argv.port)
    optimist.argv.port = rjs.defaultPort;

function values() {
    var ret = [];
    for (var i=0; i<arguments.length; ++i) {
        var val = optimist.argv[arguments[i]];
        if (typeof val === 'string') {
            ret.push(val);
        } else if (val instanceof Array) {
            ret = ret.concat(val);
        }
    }
    return ret;
}
var compiles = values('c', 'compile');
var followSymbols = values('f', 'follow-symbol');
var references = values('r', 'find-references');
var dumps = values('D', 'dump-file');
['d', 'dump'].forEach(function(arg) { if (optimist.argv[arg]) dumps.push(true); });

if (!compiles.length && !followSymbols.length && !references.length && !dumps.length) {
    console.error(usageString.replace("$0", __filename));
    process.exit(1);
}
var sock;
var server = 'ws://localhost:' + optimist.argv.port + '/';
// console.log("server", server);
var lastFile;
function sendNext() {
    function send(obj) { sock.send(JSON.stringify(obj)); }

    function createLocation(fileAndOffset) {
        var caps = /(.*),([0-9]+)?/.exec(fileAndOffset);
        // var caps = /(.*):([0-9]+):([0-9]+):?/.exec(fileAndLine);
        if (!caps) {
            console.error("Can't parse location", fileAndOffset);
            process.exit(7);
        }
        var stat = safe.fs.statSync(caps[1]);
        if (!stat || !stat.isFile()) {
            console.error(caps[1], "doesn't seem to be a file");
            process.exit(8);
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
            process.exit(4);
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
    process.exit(0);
}
try {
    sock = new ws(server);
} catch (err) {
    console.error("Can't seem to connect to server at", server, " Are you sure it's running?");
    process.exit(2);
}
sock.on('open', function() {
    sendNext();
});
var fileCache = {};
sock.on('message', function(data) {
    var response = safe.JSON.parse(data);
    if (!response) {
        console.error("Invalid response", data);
        process.exit(5);
    }
    if (verbose && typeof response.error !== undefined)
        response.errorString = rjs.errorCodeToString(response.error);
    if (verbose)
        console.log("GOT RESPONSE", response);
    function printLocation(loc) {
        var out = lastFile + ',' + loc[0];
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
        response.references.forEach(printLocation);
    } else if (response.dump) {
        console.log(response.dump);
    }
    if (response.error != rjs.ERROR_MORE_DATA)
        sendNext();
});

