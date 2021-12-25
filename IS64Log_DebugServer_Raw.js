/*
 * This is free and unencumbered software released into the public domain.
 * For more information, please refer to the LICENSE file or <http://unlicense.org/>
 */

// IS-Viewer 64 Message Register Emulation script by LuigiBlood, Kenix, Dragorn421


if (typeof PJ64_JSAPI_VERSION === 'undefined') {
	var PJ64_JSAPI_VERSION = "jsapi-1";
}

const KNOWN_PJ64_JSAPI_VERSIONS = ["jsapi-1", "jsapi-2"];

if (KNOWN_PJ64_JSAPI_VERSIONS.indexOf(PJ64_JSAPI_VERSION) == -1) {

	console.log("Unknown JS API version", PJ64_JSAPI_VERSION);
	console.log("This script is not compatible with this version of Project64.");
	console.log("You may need to upgrade this script, or downgrade Project64.");

} else { // known PJ64_JSAPI_VERSION

console.log("IS-Viewer (Debug Server)");

const _IS_MSGBUFFER_AD = 0xb3ff0000;
const _IS_MSGBUFFER_LEN = 0x10000;
const _IS_MSGBUF_HEADLEN = 0x20;
const _IS_MSGBUFFER_AD_END = _IS_MSGBUFFER_AD + _IS_MSGBUFFER_LEN;
const _IS_MSGBUF_CHKAD = _IS_MSGBUFFER_AD + 0x00;
const _IS_MSGBUF_GETPT = _IS_MSGBUFFER_AD + 0x04;
const _IS_MSGBUF_PUTPT = _IS_MSGBUFFER_AD + 0x14;
const _IS_MSGBUF_MSGTOP = _IS_MSGBUFFER_AD + _IS_MSGBUF_HEADLEN;

const ADDR_IS64_REG = new AddressRange(_IS_MSGBUFFER_AD, _IS_MSGBUF_MSGTOP - 1);
const ADDR_IS64_MSG = new AddressRange(_IS_MSGBUF_MSGTOP, _IS_MSGBUFFER_AD_END - 1);

var dev = new IS64Device(41111, _IS_MSGBUF_CHKAD, _IS_MSGBUF_GETPT, _IS_MSGBUF_PUTPT, ADDR_IS64_REG, ADDR_IS64_MSG);

function IS64Device(port, chkAddr, getAddr, putAddr, registerAddressRange, msgBufAddressRange) {

	if (PJ64_JSAPI_VERSION == "jsapi-1") {

		this.getStoreOp = function () {
			// hacky way to get value that SW will write
			var pcOpcode = mem.u32[gpr.pc];
			var tReg = (pcOpcode >> 16) & 0x1F;
			return tReg;
		}

		this.getStoreOpValue = function () {
			// hacky way to get value that SW will write
			var pcOpcode = mem.u32[gpr.pc];
			var tReg = (pcOpcode >> 16) & 0x1F;
			return gpr[tReg];
		}

		// used as a callback when an instruction reads from the IS64 address range (registers and buffer),
		// to set the appropriate register to the appropriate value
		this.readCartReg = function () {
			gpr[this.returnReg] = this.returnData;
			events.remove(this.callback);
		}

	}

	// for now, a limitation of sockets provided by the PJ64 script api is they only allow transfering strings, not byte arrays
	// this transforms a byte array like [1,2,3] into a string like '1,2,3,'
	this.encodeRaw = function (data) {
		var str = '';
		for (var i = 0; i < data.length; i++) {
			str += data[i] + ',';
		}
		return str;
	}

	// 'ABC' -> [65,66,67]
	this.stringToBytes = function (str) {
		var data = new Array(str.length);
		for (var i = 0; i < str.length; i++) {
			// codePointAt() doesn't exist. Anyway, it's ASCII
			data[i] = str.charCodeAt(i);
		}
		return data;
	}

	this.onRecvData = function (data) {

	}

	this.onCloseConnection = function () {
		this.socket = null;
	};

	this.onOpenConnection = function (newSocket) {
		if (this.socket == null) {
			this.socket = newSocket;
			this.socket.write(this.encodeRaw(this.stringToBytes("Welcome to IS64 Viewer\n")), function (data) { });

			// Bind data receive listener
			var fxn = this.onRecvData;
			fxn = fxn.bind(this);
			this.socket.on('data', fxn);

			// Bind connection close listener
			var fxn = this.onCloseConnection;
			fxn = fxn.bind(this);
			this.socket.on('close', fxn);
		} else {
			newSocket.write(this.encodeRaw(this.stringToBytes("Server only allows one connection at a time.\n")) + "256,", function (data) { });
			newSocket.close();
		}
	};

	this.onRegisterRead = function (arg) {
		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			var addr = arg;
			this.returnReg = this.getStoreOp();
		} else {
			var e = arg;
			var addr = e.address;
			this.returnReg = e.reg;
		}

		this.returnData = 0;
		if (addr == this.chkAddr) {
			// Enables the game writing to the buffer
			this.returnData = this.MAGIC_CHECK;
		} else if (addr == this.getAddr) {
			this.returnData = 0;
		} else if (addr == this.putAddr) {
			// Make the game write from the start of the buffer
			// (but it doesn't matter, see onMemoryWrite)
			// What matters is that the get and put values are the same,
			// so unless the string the game is trying to write is larger than the buffer,
			// the game will never give up writing data when checking intersection with the get-put range
			this.returnData = 0;
		}

		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			var fxn = this.readCartReg;
			fxn = fxn.bind(this);
			this.callback = events.onexec((gpr.pc + 4), fxn);
		} else {
			cpu.gpr[this.returnReg] = this.returnData;
			debug.skip();
		}
	};

	this.onRegPutWrite = function (arg) {
		// Whether if the message should be sent to the client
		var flush = false;
		// Append buffer contents to bufferStr similarly to encodeRaw
		for (var i = 0; i < this.bufferNext; i++) {
			this.bufferStr += this.buffer[i] + ',';
			// if line return (\n)
			if (this.buffer[i] == 10)
				flush = true;
		}
		this.bufferNext = 0;
		if (flush)
		{
			// socket.write happens to be really slow, so we avoid calling it too often by waiting for a line return
			if (this.socket != null)
				this.socket.write(this.bufferStr, function (data) { });
			this.bufferStr = '';
		}
	};

	this.onMemoryRead = function (arg) {
		// Game will use osPiRead at all times so it's 32-bit aligned
		// We "return" 0 explicitly to make sure we can find the
		// modified byte in onMemoryWrite when the game writes back

		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			this.returnReg = this.getStoreOp();
		} else {
			var e = arg;
			this.returnReg = e.reg;
		}

		this.returnData = 0;

		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			var fxn = this.readCartReg;
			fxn = fxn.bind(this);
			this.callback = events.onexec((gpr.pc + 4), fxn);
		} else {
			cpu.gpr[this.returnReg] = this.returnData;
			debug.skip();
		}
	};

	this.onMemoryWrite = function (arg) {
		// Game will use osPiRead at all times so it's 32-bit aligned

		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			var data = this.getStoreOpValue();
		} else {
			var e = arg;
			var data = e.value;
		}

		// The game or's (|) the byte it wants to write with the current data word at the address.
		// 0 is provided as "current data" by onMemoryRead, so this looks for a non-0 byte.
		var b;

		// Note that this relies on the memory writes happening in order.
		// The address being written to is not used.

		b = (data >> 24) & 0xFF;
		if (b != 0)
		{
			this.buffer[this.bufferNext] = b;
			this.bufferNext++;
			return;
		}

		b = (data >> 16) & 0xFF;
		if (b != 0)
		{
			this.buffer[this.bufferNext] = b;
			this.bufferNext++;
			return;
		}

		b = (data >> 8) & 0xFF;
		if (b != 0)
		{
			this.buffer[this.bufferNext] = b;
			this.bufferNext++;
			return;
		}

		// The game never writes a 0 so (data & 0xFF) should be non-0 at this point,
		// but even if it is 0 it isn't a big deal.
		this.buffer[this.bufferNext] = data & 0xFF;
		this.bufferNext++;
	};

	this.initNetwork = function () {
		// Start Server
		if (PJ64_JSAPI_VERSION == "jsapi-1") {
			this.debugServer = new Server({ port: this.port });
		} else {
			this.debugServer = new Server();
			this.debugServer.listen(this.port, '127.0.0.1');
		}
		console.log("Listening on port", this.port)
		this.socket = null;

		// Bind Connection Listener
		var fxn = this.onOpenConnection;
		fxn = fxn.bind(this);
		this.debugServer.on('connection', fxn);
	}

	this.initDeviceHooks = function () {
		// Register Read Event
		var fxn = this.onRegisterRead;
		fxn = fxn.bind(this);
		events.onread(this.registerAddressRange, fxn);

		// Put Register Write Event
		var fxn = this.onRegPutWrite;
		fxn = fxn.bind(this);
		events.onwrite(this.putAddr, fxn);

		// Memory Read Event
		var fxn = this.onMemoryRead;
		fxn = fxn.bind(this);
		events.onread(this.msgBufAddressRange, fxn);

		// Memory Write Event
		var fxn = this.onMemoryWrite;
		fxn = fxn.bind(this);
		events.onwrite(this.msgBufAddressRange, fxn);
	}

	// Magic number used to verify communication
	this.MAGIC_CHECK = 0x49533634; // ASCII for "IS64"

	// Hardware addresses used to communicate with this device.
	this.chkAddr = chkAddr;
	this.getAddr = getAddr;
	this.putAddr = putAddr;

	// Register Address Range
	this.registerAddressRange = registerAddressRange;

	// Memory Address Range
	this.msgBufAddressRange = msgBufAddressRange;

	// Initialize variables to communicate with PJ64
	this.returnData = 0;
	this.returnReg = 0;
	this.callback = 0;

	// Network communication
	this.port = port;
	this.debugServer = null;
	this.socket = null;

	// Initialize device access hooks
	this.initDeviceHooks();
	// Initialize network component
	this.initNetwork();

	this.buffer = new Array(0x10000);
	this.bufferNext = 0; // next index to write at in buffer
	this.bufferStr = '';

	console.log("chkAddr: " + this.chkAddr.hex());
	console.log("getAddr: " + this.getAddr.hex());
	console.log("putAddr: " + this.putAddr.hex());
	console.log("registerAddressRange: " + this.registerAddressRange.start.hex() + " - " + this.registerAddressRange.end.hex());
	console.log("msgBufAddressRange: " + this.msgBufAddressRange.start.hex() + " - " + this.msgBufAddressRange.end.hex());
}

} // end known PJ64_JSAPI_VERSION
