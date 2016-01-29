/*global module, require */

'use strict';

require('util').inspect = require('eyes').inspector({stream:null});

var outputs = [];

function Sink(log, verbosity) {
    this.log = log;
    this.verbosity = verbosity;
}

function addSink(sink) {
    outputs.push(sink);
}

function removeSink(sink) {
    for (let i=0; i<outputs.length; ++i) {
        if (outputs[i] == sink) {
            outputs.splice(i, 1);
            break;
        }
    }
}

function sendToOutput(verbosity, str)
{
    if (!str)
        return;
    for (let i=0; i<outputs.length; ++i) {
        if (outputs[i].verbosity >= verbosity) {
            outputs[i].log(str);
        }
    }
}

function formatLog(args) {
    var out = '';
    function add(obj) {
        var str;
        if (obj instanceof Object) {
            try {
                str = JSON.stringify(obj);
            } catch (err) {
            }
        }
        if (!str) {
            str = '' + obj;
        }
        if (out.length && out[out.length - 1] != ' ')
            out += ' ';
        out += str;
    }
    for (let i=0; i<args.length; ++i) {
        add(args[i]);
    }
    return out;
}

function writeResponse() { sendToOutput(0, formatLog(arguments)); }
function log() { sendToOutput(1, formatLog(arguments)); }
function verboseLog() { sendToOutput(2, formatLog(arguments)); }

module.exports = {
    Sink: Sink,
    addSink: addSink,
    removeSink: removeSink,
    log: log,
    verboseLog: verboseLog,
    writeResponse: writeResponse,
    outputs: outputs
};
