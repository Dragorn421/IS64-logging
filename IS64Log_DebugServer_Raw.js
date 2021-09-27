//IS-Viewer 64 Message Register Emulation script by LuigiBlood & Kenix

console.log("IS-Viewer (Debug Server)");

//const _IS_MSGBUFFER_AD =  0xb1ff0000;
const _IS_MSGBUFFER_AD = 0xb3ff0000;
const _IS_MSGBUFFER_LEN = 0x10000;
const _IS_MSGBUF_HEADLEN = 0x20;
const _IS_MSGBUFFER_AD_END = _IS_MSGBUFFER_AD + _IS_MSGBUFFER_LEN;
const _IS_MSGBUF_CHKAD = _IS_MSGBUFFER_AD + 0x00;
const _IS_MSGBUF_GETPT = _IS_MSGBUFFER_AD + 0x04;
const _IS_MSGBUF_PUTPT = _IS_MSGBUFFER_AD + 0x14;
const _IS_MSGBUF_MSGTOP = _IS_MSGBUFFER_AD + _IS_MSGBUF_HEADLEN;
const _IS_MSGBUF_MSGLEN = _IS_MSGBUF_HEADLEN - _IS_MSGBUF_HEADLEN;

const ADDR_IS64_REG = new AddressRange(_IS_MSGBUFFER_AD, _IS_MSGBUF_MSGTOP - 1);
const ADDR_IS64_MSG = new AddressRange(_IS_MSGBUF_MSGTOP, _IS_MSGBUFFER_AD_END - 1);

var dev = new IS64Device(411, _IS_MSGBUF_CHKAD, _IS_MSGBUF_GETPT, _IS_MSGBUF_PUTPT, ADDR_IS64_REG, ADDR_IS64_MSG);

function IS64Device(port, chkAddr, getAddr, putAddr, registerAddressRange, msgBufAddressRange) {
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

	this.readCartReg = function () {
		gpr[this.returnReg] = this.returnData;
		events.remove(this.callback);
	}

	this.emptyMsg = function () {
		for (var i = 0; i < this.msgBuf.length; i++) {
			this.msgBuf[i] = 0;
		}
	}

	this.encodeRaw = function (data) {
		var str = '';
		for (var i = 0; i < data.length; i++) {
			str += data[i] + ','
		}
		return str;
	}

	this.outputString = function (start, end) {
		var slice = start < end ?
			this.msgBuf.slice(start, end) :
			this.msgBuf.slice(start, this.msgBuf.length).concat(this.msgBuf.slice(0, end));

		if (this.socket != null) {
			this.socket.write(this.encodeRaw(slice), function (data) { });
		}
	}

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

	this.onRegisterRead = function (addr) {
		this.returnReg = this.getStoreOp();
		this.returnData = 0;
		if (addr == this.chkAddr) {
			this.returnData = this.chkReg;
		} else if (addr == this.getAddr) {
			this.returnData = this.getReg;
		} else if (addr == this.putAddr) {
			this.returnData = this.putReg;
		}
		var fxn = this.readCartReg;
		fxn = fxn.bind(this);
		this.callback = events.onexec((gpr.pc + 4), fxn);
	};

	this.onRegisterWrite = function (addr) {
		this.returnReg = this.getStoreOp();
		if (addr == this.chkAddr) {
			this.chkReg = this.getStoreOpValue();
		} else if (addr == this.getAddr) {
			this.getReg = this.getStoreOpValue();
		} else if (addr == this.putAddr) {
			//Handle this output
			this.outputString(this.putReg, this.getStoreOpValue());
			this.putReg = this.getStoreOpValue();
		}
	};

	this.onMemoryRead = function (addr) {
		// Game will use osPiRead at all times so it's 32-bit aligned

		this.returnReg = this.getStoreOp();
		var offset = addr - this.msgBufAddressRange.start;
		this.returnData = ((this.msgBuf[offset + 0] & 0xFF) << 24);
		this.returnData |= ((this.msgBuf[offset + 1] & 0xFF) << 16);
		this.returnData |= ((this.msgBuf[offset + 2] & 0xFF) << 8);
		this.returnData |= ((this.msgBuf[offset + 3] & 0xFF) << 0);

		var fxn = this.readCartReg;
		fxn = fxn.bind(this);
		this.callback = events.onexec((gpr.pc + 4), fxn);
	};

	this.onMemoryWrite = function (addr) {
		// Game will use osPiRead at all times so it's 32-bit aligned

		this.returnReg = this.getStoreOp();
		var offset = addr - this.msgBufAddressRange.start;
		var datamsg = this.getStoreOpValue();
		this.msgBuf[offset + 0] = ((datamsg >> 24) & 0xFF);
		this.msgBuf[offset + 1] = ((datamsg >> 16) & 0xFF);
		this.msgBuf[offset + 2] = ((datamsg >> 8) & 0xFF);
		this.msgBuf[offset + 3] = ((datamsg >> 0) & 0xFF);
	};

	this.initNetwork = function () {
		// Start Server
		this.debugServer = new Server({ port: this.port });
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

		// Register Write Event
		var fxn = this.onRegisterWrite;
		fxn = fxn.bind(this);
		events.onwrite(this.registerAddressRange, fxn);

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
	this.MAGIC_CHECK = 0x49533634; // IS64

	// Hardware addresses used to communicate with this device.
	this.chkAddr = chkAddr;
	this.getAddr = getAddr;
	this.putAddr = putAddr;

	// Register Address Range
	this.registerAddressRange = registerAddressRange;

	// Memory Address Range
	this.msgBufAddressRange = msgBufAddressRange;

	// Initialize Device registers
	this.chkReg = this.MAGIC_CHECK;
	this.getReg = 0;
	this.putReg = 0;

	// Initialize Device memory
	this.msgBuf = new Array(this.msgBufAddressRange.end - this.msgBufAddressRange.start);

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

	console.log("chkAddr: " + this.chkAddr.hex());
	console.log("getAddr: " + this.getAddr.hex());
	console.log("putAddr: " + this.putAddr.hex());
	console.log("registerAddressRange: " + this.registerAddressRange.start.hex() + " - " + this.registerAddressRange.end.hex());
	console.log("msgBufAddressRange: " + this.msgBufAddressRange.start.hex() + " - " + this.msgBufAddressRange.end.hex());
}
