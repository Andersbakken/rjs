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
                   '  -d|--dump [file]\n' +
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
var dumps = values('d', 'dump');
if (!valid) {
    console.error(usageString.replace("$0", __filename));
    process.exit(1);
}
var sock;
var server = 'ws://localhost:' + optimist.argv.port + '/';
// console.log("server", server);
var lastFile;
function sendNext() {
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
        location = createLocation(references.splice(0, 1)[0]);
        sock.send(JSON.stringify({ type: rjs.MESSAGE_FIND_REFERENCES, location: location }));
        return;
    }

    if (dumps.length) {
        var file = path.resolve(dumps.splice(0, 1)[0]);
        sock.send(JSON.stringify({ type: rjs.MESSAGE_DUMP, file: file }));
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
        response.error = rjs.errorCodeToString(response.error);
    // console.log("GOT RESPONSE", response);
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
    }
    sendNext();
});


//     }
// }
