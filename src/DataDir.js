/*global require, module*/

'use strict';

var safe = require('safetydance');
var Args = require('./Args');
var log = require('./log');

function filePath()
{
    return Args.args['data-dir'] + '/indexed.json';
}
function init()
{
    var indexed;
    if (Args.args.clear) {
        try {
            require('rmdir-recursive').sync(Args.args['data-dir']);
        } catch (err) {
            log.log("Couldn't remove datadir " + err.toString());
        }
    } else {
        var contents = safe.fs.readFileSync(filePath(), 'utf-8');
        if (contents) {
            indexed = safe.JSON.parse(contents);
        }
    }
    safe.fs.mkdirSync(Args.args['data-dir']);
    return indexed ? indexed.files : [];
}

function save(object)
{
    return safe.fs.writeFileSync(filePath(), JSON.stringify(object, null, 4));
}

function add(file)
{
    var contents = safe.JSON.parse(filePath(), 'utf-8');
    if (!contents) {
        contents = { files: [] };
    } else {
        for (let i=0; i<contents.files.length; ++i) {
            if (contents.files[i].file === file)
                return false;
        }
    }
    contents.files.push({ file: file });
    return save(contents);
}

function remove(file)
{
    var contents = safe.JSON.parse(safe.fs.readFileSync(Args.cargs['data-dir'] + '/indexed.json', 'utf-8'));
    if (!contents)
        return false;
    var found = false;
    for (let i=0; i<contents.files.length; ++i) {
        if (contents.files[i].file === file) {
            found = true;
            contents.files.splice(i, 1);
            break;
        }
    }
    if (found)
        return false;
    return save(contents);
}

module.exports = {
    init: init,
    add: add,
    remove: remove
};
