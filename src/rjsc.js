#!/usr/bin/env node

var fs = require('fs');
var rjs = require('rjs');
var ws = require('ws');
var path = require('path');
var parseArgs = require('minimist');
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
                   '  -D|--daemon\n' +
                   '  -F|--find-symbols [symbolName]\n' +
                   '  -S|--list-symbols [optional prefix]\n' +
                   '  -P|--file [file]\n' +
                   '  -p|--port [port] (default ' + rjs.defaultPort + ')\n');

var parseArgsOptions = {
    alias: {
        c: 'compile',
        f: 'follow-symbol',
        r: 'find-references',
        F: 'dump-file',
        d: 'dump',
        u: 'cursor-info',
        N: 'no-context',
        v: 'verbose',
        D: 'daemon',
        p: 'port',
        F: 'find-symbols',
        S: 'list-symbols',
        P: 'file'
    },
    default: {
        p: rjs.defaultPort
    },
    boolean: [ "dump", "no-context", "verbose", "daemon" ]
};

function exit(code, message, showUsage)
{
    if (showUsage)
        console.error(usageString.replace("$0", __filename));
    if (message)
        console.error(message);
    process.exit(code);
}
var args = parseArgs(process.argv.slice(2), parseArgsOptions);

(function() {
    console.log(args);
    if (args['_'].length)
        exit(1, "Invalid arguments", true);
    var validArgs = {};
    var arg;
    for (arg in parseArgsOptions.alias) {
        validArgs[arg] = true;
        validArgs[parseArgsOptions.alias[arg]] = true;
    }
    for (arg in args) {
        if (arg != "_" && args.hasOwnProperty(arg) && !validArgs[arg])
            exit(1, "Unrecognized argument " + arg, true);
    }
    if (args['file'] instanceof Array)
        exit(1, "Too many --file arguments", true);
})();

var verbose = args.verbose;
var showContext = !args['no-context'];
var daemon = args.daemon;
var socket;
var readyForCommand = false;
var server = 'ws://localhost:' + args.port + '/';
var lastFile;
var lastMessage;

var commands = [];
function addCommands(argv)
{
    var parsed = argv ? parseArgs(argv, parseArgsOptions) : args;
    var file = parsed['file'];
    function add(arg) {
        function createCommand(val) {
            var cmd = { type: arg, value: val };
            if (file)
                cmd.file = file;
            commands.push(cmd);
        }
        var val = parsed[arg];
        if (val) {
            if (val instanceof Array) {
                val.forEach(createCommand);
            } else {
                createCommand(val);
            }
        }
    }

    add('compile');
    add('follow-symbol');
    add('find-references');
    add('dump-file');
    add('cursor-info');
    add('dump');
    add('find-symbols');
    add('list-symbols');
}

addCommands(undefined);

if (!commands.length && !daemon) {
    console.error(usageString.replace("$0", __filename));
    process.exit(1);
}

function finish(code) {
    if (!daemon)
        process.exit(code);
}

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

function sendNext() {
    function send(obj) {
        lastMessage = obj;
        socket.send(JSON.stringify(obj));
        if (verbose)
            console.log("Sending message", obj);
    }
    if (!commands.length) {
        readyForCommand = true;
        finish(0);
        return;
    }

    readyForCommand = false;
    var c = commands.splice(0, 1)[0];
    var location;
    switch (c.type) {
    case 'compile':
        var stat = safe.fs.statSync(c.value);
        if (!stat || !stat.isFile()) {
            console.error(c.value, 'does not seem to be a file');
            finish(4);
            return;
        }

        send({ type: rjs.MESSAGE_COMPILE, file: path.resolve(c.value) });
        break;
    case 'follow-symbol':
        send({ type: rjs.MESSAGE_FOLLOW_SYMBOL, location: createLocation(c.value) });
        break;
    case 'find-references':
        send({ type: rjs.MESSAGE_FIND_REFERENCES, location: createLocation(c.value) });
        break;
    case 'dump':
        send({ type: rjs.MESSAGE_DUMP });
        break;
    case 'dump-file':
        send({ type: rjs.MESSAGE_DUMP, file: path.resolve(c.value) });
        break;
    case 'cursor-info':
        send({ type: rjs.MESSAGE_CURSOR_INFO, location: createLocation(c.value) });
        break;
    case 'list-symbols':
        send({ type: rjs.MESSAGE_LIST_SYMBOLS, file: c.file, prefix: typeof c.value === 'string' ? c.value : undefined });
        break;
    case 'find-symbols':
        send({ type: rjs.MESSAGE_FIND_SYMBOLS, file: c.file, symbolName: c.value });
        break;
    }
}

socket = new ws(server);
socket.on('error', function(err) { process.exit(2); });
socket.on('open', sendNext);

var fileCache = {};
socket.on('message', function(data) {
    var response = safe.JSON.parse(data);
    if (!response) {
        console.error("Invalid response", data);
        finish(5);
    }
    if (verbose && typeof response.error !== undefined)
        response.errorString = rjs.errorCodeToString(response.error);
    if (verbose)
        console.log("Got response", response);
    function printLocation(loc, header) {
        var out = (header || "") + loc.file + ',' + loc.offset;
        if (showContext) {
            var contents = fileCache[lastFile];
            if (!contents) {
                contents = safe.fs.readFileSync(lastFile, { encoding: 'utf8' });
                if (contents) {
                    fileCache[lastFile] = contents;
                }
            }
            if (contents && contents.length > loc.offset) {
                var prevNewLine = contents.lastIndexOf('\n', loc.offset) + 1;
                var nextNewLine = contents.indexOf('\n', loc.offset);
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
    } else if (response.locations) {
        response.locations.forEach(printLocation);
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
    } else if (response.symbolNames) {
        response.symbolNames.forEach(function(name) { console.log(name); });
    }
    if (response.error != rjs.ERROR_MORE_DATA)
        sendNext();
});

if (daemon) {
    process.stdin.setEncoding('utf8');
    var pendingStdIn = "";
    process.stdin.on('readable', function() {
        var read = process.stdin.read();
        if (read) {
            pendingStdIn += read;
            var lines = pendingStdIn.split('\n');
            if (lines.length > 1) {
                for (var i=0; i<lines.length - 1; ++i) {
                    addCommands(lines[i].split(' '));
                }
                pendingStdIn = lines[lines.length - 1] || "";
                if (readyForCommand)
                    sendNext();
            }
        }
    });

}



