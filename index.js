'use strict';

var _os       = require('os'),
    _         = require('underscore'),
    diskspace = require('diskspace'),
    mongo     = require('mongodb').MongoClient,
    storage   = null,
    monitors = [];

var configuration = exports.configuration = {
    mongoUrl: 'mongodb://localhost:27017/system-monitor',
}

var globalConfigurations = { interval: 1000 };

mongo.connect(configuration.mongoUrl, function(error, db) {
    if (error) {
        console.log('Failed to connect to Mongo: ' + error);

        process.exit(1);
    }

    exports.storage = storage = db;
});

//
// A basic boilerplate for new listener.
// #persist and #usage methods must be defined explicitly for each new listener.
// This also adds newly created listener to a list of known listeners
//
var constructor = exports.constructor = function(key) {
    var _monitor = {
        configuration: _.extend({ collection: key }, globalConfigurations),

        utils: {},

        persist: function() {
            return new Error("Minotor persistance is not defined: " + key);
        },

        usage: function() {
            return new Error("Minotor usage is not defined: " + key);
        },

        start: function() {
            var callback = function() { _monitor.usage(_monitor.persist) };

            this.monitor = setInterval(callback, this.configuration.interval);
        },

        stop: function() {
            clearInterval(this.monitor);
        }
    }

    exports[key] = _monitor;
    monitors.push(_monitor);

    return _monitor;
}

/* CPU Usage definition
 * configurations:
 *   - updateInterval: time difference in milliseconds for CPU times calculation
 *     if #updateInterval is not set then the averages since a system boot will be shown
*/

var _cpu = _.extend(constructor('cpu'), {
    configuration: _.extend({ updateInterval: 1000, collection: 'cpu' }, globalConfigurations),

    persist: function(results) {
        var collection = storage.collection(_cpu.configuration.collection);

        collection.insert({ createdAt: new Date(), value: results }, function(error, result) {
            if (error)
                console.log('Error while inserting metrics: ' + error);
        });

    },

    utils: {
        times: function() {
            var cpus  = _os.cpus(),
                times = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };

            for (var cpu in cpus)
                for (var time in cpus[cpu].times) times[time] += cpus[cpu].times[time]

            times.total = times.user + times.nice + times.sys + times.idle + times.irq;
            return { idle: times.idle, total: times.total }
        }
    },

    usage: function(callback) {
        if (typeof _cpu.configuration.updateInterval === 'undefined' || _cpu.configuration.updateInterval === null) {
            var times = _cpu.utils.times(),
                usage = Math.floor((1 - (times.idle/times.total)) * 100);

            callback(usage);
        } else {
            var _times = _cpu.utils.times();

            setTimeout(function() {
                var times = _cpu.utils.times();

                var idle  = times.idle  - _times.idle,
                    total = times.total - _times.total;

                var usage = Math.floor((1 - (idle/total)) * 100);
                callback(usage);
            }, _cpu.configuration.updateInterval);
        }
    }
});

var _mem = _.extend(constructor('mem'), {
    configuration: _.extend({ percentageOutput: true, collection: 'mem' }, globalConfigurations),

    persist: function(results) {
        var collection = storage.collection(_mem.configuration.collection);

        collection.insert({ createdAt: new Date(), value: results }, function(error, result) {
            if (error)
                console.log('Error while inserting metrics: ' + error);
        });
    },

    usage: function(callback) {
        if (_mem.configuration.percentageOutput === true) {
            callback(100 - Math.floor(_os.freemem()/_os.totalmem() * 100));
        } else {
            callback({ freemem: (_os.freemem()/(1024*1024)), totalmem: (_os.totalmem()/(1024*1024)) });
        }
    }
});

var _disk = _.extend(constructor('disk'), {
    configuration: _.extend({ mountPoint: '/', collection: 'disk' }, globalConfigurations),

    persist: function(results) {
        var collection = storage.collection(_disk.configuration.collection);

        collection.insert({ createdAt: new Date(), value: results.free }, function(error, result) {
            if (error)
                console.log('Error while inserting metrics: ' + error);
        });
    },

    usage: function(callback) {
        diskspace.check(_disk.configuration.mountPoint, function(error, total, free, status) {
            if (error) {
                console.log(error.message);

                _disk.stop();
                return error;
            }

            callback({ free: Math.floor(free/(1024*1024)), used: Math.floor((total - free)/(1024*1024)) });
        });
    }
});

// Starts all configured listeners
exports.start = function() {
    _.each(monitors, function(monitor) {
        monitor.start();
    });
}

// Stops all configured listeners
exports.stop  = function() {
    _.each(monitors, function(monitor) {
        monitor.stop();
    });
}

