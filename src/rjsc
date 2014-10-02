#!/usr/bin/env node

/*global process, require, __filename */

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
                   '  -U|--dump-file [file]\n' +
                   '  -d|--dump\n' +
                   '  -h|--help\n' +
                   '  -u|--cursor-info [location]\n' +
                   '  -N|--no-context\n' +
                   '  -g|--log\n' +
                   '  -v|--verbose\n' +
                   '  -F|--find-symbols [symbolName]\n' +
                   '  -S|--list-symbols [optional prefix]\n' +
                   '  -P|--file [file]\n' +
                   '  -p|--port [port] (default ' + rjs.defaultPort + ')\n');

var parseArgsOptions = {
    alias: {
        c: 'compile',
        f: 'follow-symbol',
        r: 'find-references',
        U: 'dump-file',
        d: 'dump',
        h: 'help',
        u: 'cursor-info',
        N: 'no-context',
        v: 'verbose',
        p: 'port',
        g: 'log',
        F: 'find-symbols',
        S: 'list-symbols',
        P: 'file'
    },
    default: {
        p: rjs.defaultPort
    },
    boolean: [ 'dump', 'no-context', 'verbose', 'log' ]
};

function exit(code, message, showUsage)
{
    function log(out) {
        if (code) {
            console.error(out);
        } else {
            console.log(out);
        }
    }

    if (showUsage) {
        log(usageString.replace('$0', __filename));
    }
    if (message)
        log(message);
    process.exit(code);
}

var args = parseArgs(process.argv.slice(2), parseArgsOptions);

(function() {
    if (args['_'].length)
        exit(1, 'Invalid arguments', true);
    var validArgs = {};
    var arg;
    for (arg in parseArgsOptions.alias) {
        validArgs[arg] = true;
        validArgs[parseArgsOptions.alias[arg]] = true;
    }
    for (arg in args) {
        if (arg != '_' && args.hasOwnProperty(arg) && !validArgs[arg])
            exit(1, 'Unrecognized argument ' + arg, true);
    }
    if (args['file'] instanceof Array)
        exit(1, 'Too many --file arguments', true);
    if (args['help']) {
        exit(0, '', true);
    }
})();

var verbose = args.verbose;
var showContext = !args['no-context'];
var socket;
var readyForCommand = false;
var server = 'ws://localhost:' + args.port + '/';
var lastMessage;


var commands = rjs.createCommands(args);

if (!commands.length) {
    console.error(usageString.replace('$0', __filename));
    process.exit(1);
}

function finish(code) {
    process.exit(code);
}

function sendNext() {
    if (!commands.length) {
        readyForCommand = true;
        finish(0);
        return;
    }

    readyForCommand = false;
    lastMessage = commands.splice(0, 1)[0];
    socket.send(JSON.stringify(lastMessage));
    if (verbose)
        console.log('Sending message', lastMessage);
}

socket = new ws(server);
socket.on('error', function(err) { console.error("Unable to connect to server:", err.errno); process.exit(2); });
socket.on('close', function(err) { console.error("Lost connection to server:", err); process.exit(3); });
socket.on('open', sendNext);

var fileCache = {};
function printLocation(location, header) {
    console.log(rjs.printLocation({ location: location,
                                    header: header,
                                    showContext: showContext,
                                    fileCache: fileCache }));
}

socket.on('message', function(data) {
    var response = safe.JSON.parse(data);
    if (!response) {
        console.error('Invalid response', data);
        finish(5);
    }
    if (verbose)
        console.log('Got response', response);
    if (response.target) {
        printLocation(response.target);
    } else if (response.references) {
        response.references.forEach(function(loc) { printLocation(loc); });
    } else if (response.locations) {
        response.locations.forEach(function(loc) { printLocation(loc); });
    } else if (response.dump) {
        console.log(response.dump);
    } else if (response.cursorInfo) {
        printLocation(response.cursorInfo.location);
        console.log('Name:',
                    response.cursorInfo.name,
                    response.cursorInfo.definition ? 'Definition' : 'Reference');
        if (response.cursorInfo.references && response.cursorInfo.references.length) {
            console.log('References:');
            response.cursorInfo.references.forEach(function(loc) { printLocation(loc, '  '); });
        }
        // console.log(response.cursorInfo);
    } else if (response.symbolNames) {
        response.symbolNames.forEach(function(name) { console.log(name); });
    } else if (response.log) {
        console.log(response.log);
    }
    if (response.error != rjs.ERROR_MORE_DATA) {
        if (response.error != rjs.ERROR_OK) {
            console.error("Error:", response.error);
        }
        sendNext();
    }
});
