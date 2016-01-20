/*global require, process, rjs, module, setTimeout, os, __filename*/

'use strict';

var parseArgs = require('minimist');
var os = require('os');
var defaultDataDir = os.homedir() + '/.rjsd';
var rjs = require('./rjs');
var fs = require('fs');
var usageString = ('Usage:\n$0 ...options\n' +
                   '-v|--verbose\n' +
                   '-h|--help\n' +
                   '-l|--logfile\n' +
                   '-s|--silent\n' +
                   '-C|--clear\n' +
                   '-D|--data-dir [default: ' + defaultDataDir + ' ]\n' +
                   '-q|--quit-after [seconds]\n' +
                   '-o|--format [raw (default), elisp, xml]\n' +
                   '-p|--port [default: ' + rjs.defaultPort + ' ]\n');
var log = require('./log');
var parseArgsOptions = {
    alias: {
        l: 'logfile',
        v: 'verbose',
        p: 'port',
        h: 'help',
        s: 'silent',
        C: 'clear',
        D: 'data-dir',
        q: 'quit-after',
        o: 'format'
    },
    default: {
        p: rjs.defaultPort,
        D: defaultDataDir,
        o: 'raw'
    }
};
var args = parseArgs(process.argv.slice(2), parseArgsOptions);

log.addSink(new log.Sink(console.error.bind(console), args.silent ? 0 : args.verbose ? 2 : 1));

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

if (args.help) {
    exit(0, '', true);
}

if (args.logfile) {
    function logFile(str) {
        if (str[str.length - 1] != '\n')
            str += '\n';
        fs.appendFile(args.logfile, str, function (err) {});
    }
    log.addSink(new log.Sink(logFile, 2));
}

if (args['quit-after'] > 0) {
    setTimeout(function() { process.exit(); }, args['quit-after'] * 1000);
}

module.exports = {
    args: args,
    parseArgs: parseArgs
};
