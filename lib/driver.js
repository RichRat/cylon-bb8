/*
 * cylon-bb8 driver
 * http://cylonjs.com
 *
 * Copyright (c) 2015 Justin McGrew
 * Licensed under the MIT license.
 */

"use strict";

var Cylon = require("cylon");
var Sphero = require("hybridgroup-spheron");

var Logger = Cylon.Logger;

var BLE_SERVICE =   "22bb746f2bb075542d6f726568705327",
    BLE_WAKE =      "22bb746f2bbf75542d6f726568705327",
    BLE_TX_POWER =  "22bb746f2bb275542d6f726568705327",
    BLE_ANTI_DOS =  "22bb746f2bbd75542d6f726568705327",
    BLE_RSSI =      "22bb746f2bb675542d6f726568705327",

    ROBOT_SERVICE = "22bb746f2ba075542d6f726568705327",
    ROBOT_COMMAND = "22bb746f2ba175542d6f726568705327",
    ROBOT_NOTIFY =  "22bb746f2ba675542d6f726568705327";

var BB8Driver = module.exports = function BB8Driver() {
    BB8Driver.__super__.constructor.apply(this, arguments);

    this.commands = {
        wake: this.wake,
        setTXPower: this.setTXPower,
        setRGB: this.setRGB,
        roll: this.roll,
        stop: this.stop,
        setRawMotorValues: this.setRawMotorValues,
        setStabilization: this.setStabilization
    };

    // Raw Motor Commands for use with setRawMotorValues
    // Off (motor is open circuit)
    this.MotorOff = 0x00;

    // Forward
    this.MotorForward = 0x01;

    // Reverse
    this.MotorReverse = 0x02;

    // Brake (motor is shorted)
    this.MotorBrake = 0x03;

    // Ignore (motor mode and power is left unchanged)
    this.MotorIgnore = 0x04;

    this.heading = 0;
};

Cylon.Utils.subclass(BB8Driver, Cylon.Driver);

BB8Driver.prototype.start = function (callback) {
    Logger.debug("BB8Driver.start");
    callback();
};

BB8Driver.prototype.halt = function (callback) {
    Logger.debug("BB8Driver.halt");
    callback();
};

/*** BLE COMMANDS ***/

/**
 * Tells the BB8 to wake up
 *
 * @param {Function} callback function to be triggered when the BB8 is awake
 * @return {void}
 * @publish
 */
BB8Driver.prototype.wake = function (callback) {
    Logger.debug("BB8Driver.wake");
    this._writeServiceCharacteristic(
        BLE_SERVICE,
        BLE_WAKE,
        1,
        callback
    );
};

/**
 * Sets the BLE transmit power for the BB8.
 *
 * Uses more battery, but gives longer range
 *
 * @param {Number} level power to set
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.setTXPower = function (level, callback) {
    Logger.debug("BB8Driver.setTXPower (level)", level);
    this._writeServiceCharacteristic(BLE_SERVICE, BLE_TX_POWER, level, callback);
};

/**
 * Enables developer mode on the BB8.
 *
 * This is accomplished via sending a special string to the Anti-DoS service,
 * setting TX power to 7, and telling the Sphero to wake up.
 *
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.devModeOn = function (callback) {
    Logger.debug("BB8Driver.devModeOn");
    var bb8 = this;

    bb8.setAntiDos(function () {
        bb8.setTXPower(7, function () {
            bb8.wake(function (err, data) {
                callback(err, data);
            });
        });
    });
};

/**
 * Sends a special Anti-DoS string to the BB8.
 *
 * Used when enabling developer mode
 *
 * @param {Function} callback function to call when done
 * @return {void}
 */
BB8Driver.prototype.setAntiDos = function (callback) {
    Logger.debug("BB8Driver.setAntiDos");
    var str = "011i3";
    var bytes = [];

    for (var i = 0; i < str.length; ++i) {
        bytes.push(str.charCodeAt(i));
    }

    this._writeServiceCharacteristic(BLE_SERVICE, BLE_ANTI_DOS, bytes, callback);
};

/*** ROBOT COMMANDS ***/

/**
 * Sets the RGB color of BB8's built-in LED
 *
 * @param {Number} color color value to set
 * @param {Boolean} persist whether color should persist through power cycles
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.setRGB = function (color, persist, callback) {
    Logger.debug("BB8Driver.setRGB (color,persist)", color, persist);
    var packet = Sphero.commands.api.setRGB(color, persist, {resetTimeout: true});
    this._writeServiceCharacteristic(ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

/**
 * Tells BB8 to roll in a particular speed and heading
 *
 * @param {Number} speed speed to roll at
 * @param {Number} heading heading to roll at
 * @param {Number} state roll state value
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.roll = function (speed, heading, state, callback) {
    Logger.debug("BB8Driver.roll (speed,heading,state)", speed, heading, state);
    this.heading = heading;

    var packet = Sphero.commands.api.roll(
        speed,
        heading,
        state,
        {resetTimeout: true}
    );

    this._writeServiceCharacteristic(ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

/**
 * Tells BB8 to stop rolling
 *
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.stop = function (callback) {
    Logger.debug("BB8Driver.stop");
    this.roll(0, this.heading, 1, callback);
};

/**
 * Allows for direct control of both motors, rather than auto-control via the
 * stabilization system.
 *
 * Each motor (left and right) requires a mode (see below) and a power value
 * from 0-255. This command will disable stabilization if both modes aren't
 * "ignore" so you'll need to re-enable it via setStabilization() once you're
 * done.
 *
 * @param {Number} lm left motor mode
 * @param {Number} lp left motor power
 * @param {Number} rm right motor mode
 * @param {Number} rp right motor power
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.setRawMotorValues = function (lm, lp, rm, rp, callback) {
    Logger.debug("BB8Driver.setRawMotorValues");
    var packet = Sphero.commands.api.setRawMotorValues(
        lm, lp,
        rm, rp,
        {resetTimeout: true}
    );

    this._writeServiceCharacteristic(ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

/**
 * Used to enable/disable BB8's auto-stabilization
 *
 * Often used after setting raw motor commands.
 *
 * @param {Number} enable stabilization enable mode
 * @param {Function} callback function to call when done
 * @return {void}
 * @publish
 */
BB8Driver.prototype.setStabilization = function (enable, callback) {
    Logger.debug("BB8Driver.setStabilization");
    var packet = Sphero.commands.api.setStabilization(
        enable,
        {resetTimeout: true}
    );

    this._writeServiceCharacteristic(ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

/**
 *
 * @param sensorRateDivisor; recommend:2,10
 * @param frames; #frames per packet; recommend 10
 * @param mask; recommend: 255; 4294967295
 * @param packetCount: recommend:0
 * @param mask2: optional
 * @param callback
 */
BB8Driver.prototype.setDataStreaming = function(sensorRateDivisor, frames, mask, packetCount, mask2, callback) {
    Logger.debug("BB8Driver.setDataStreaming");
    var packet = Sphero.commands.api.setDataStreaming(
        sensorRateDivisor, frames, mask, packetCount, mask2,
        {resetTimeout: true,  requestAcknowledgement: true}
    );

    this._writeServiceCharacteristic(
        ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

BB8Driver.prototype.getDeviceMode = function(callback) {
    Logger.debug("BB8Driver.getDeviceMode");
    var packet = Sphero.commands.api.getDeviceMode(
        {resetTimeout: true, requestAcknowledgement: true}
    );

    this._writeServiceCharacteristic(ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

BB8Driver.prototype.getRGB = function(callback) {
    Logger.debug("BB8Driver.getRGB");
    var packet = Sphero.commands.api.getRGB(
        {resetTimeout: true, requestAcknowledgement: true}
    );

    this._writeServiceCharacteristic(
        ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

BB8Driver.prototype.getPowerState = function(callback) {
    Logger.debug("BB8Driver.getPowerState");
    var packet = Sphero.commands.core.getPowerState(
        {resetTimeout: true, requestAcknowledgement: true}
    );
    this._writeServiceCharacteristic(
        ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

BB8Driver.prototype.getChassisID = function(callback) {
    Logger.debug("BB8Driver.getChassisID");
    var packet = Sphero.commands.api.getChassisID(
        {resetTimeout: true, requestAcknowledgement: true}
    );

    this._writeServiceCharacteristic(
        ROBOT_SERVICE,
        ROBOT_COMMAND,
        packet,
        callback
    );
};

/*** BLE INTERFACE ***/

/**
 * Writes a service characteristic to the BB8.
 *
 * @param {Number} s service id
 * @param {Number} c characteristic id
 * @param {Number} value value to write
 * @param {Function} callback function to call when done
 * @return {void}
 */
BB8Driver.prototype._writeServiceCharacteristic = function (s, c, value, callback) {
    this.connection.writeServiceCharacteristic(s, c, new Buffer(value),
        function (err, data) {
            if (typeof callback === "function") {
                callback(err, data);
            }
        }
    );
};

BB8Driver.prototype._readServiceCharacteristic = function (s, c, callback) {
    this.connection.readServiceCharacteristic(s, c,callback);
};

BB8Driver.prototype.getServiceCharacteristic = function (s, c, callback) {
    this.connection.getCharacteristic(s, c, function(error, notifier) {
        if (error) {
            callback(error);
        }
        else {
            callback(null, notifier);
        }
    });
};

