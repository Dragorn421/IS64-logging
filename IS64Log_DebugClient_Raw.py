import socket
import sys
import argparse
import codecs
import time


def terminate(*args):
    if args:
        print(*args)
    input("Press enter to exit...")


# Wrapping sys.excepthook:
# In case an error happens and the script wasn't run from a terminal,
# waiting for input prevents the window from closing immediately

base_excepthook = sys.excepthook


def excepthook(*args):
    base_excepthook(*args)
    terminate()


sys.excepthook = excepthook

# Command line arguments declaration

parser = argparse.ArgumentParser(description="IS64 debug log client.")

parser.add_argument(
    "--server-host",
    type=str,
    default="localhost",
    help="Hostname or ip address of the server (use your local ip address if python is running in WSL and the emulator in Windows, eg 192.168.1.20)",
)
parser.add_argument(
    "--server_port",
    type=int,
    default=411,
    help="Server port to connect to",
)
parser.add_argument(
    "--no-persist",
    action="store_false",
    dest="persist",
    help="Don't persist in (re)connecting with the server",
)

parser.add_argument(
    "--write-raw",
    type=str,
    default=None,
    help="Write raw data (no decoding/encoding done) to a file",
)
parser.add_argument("--write", type=str, default=None, help="Write logs to a file")
parser.add_argument(
    "--encoding-in",
    type=str,
    default="euc-jp",
    help="Input encoding (the one used by the game to write)",
)

parser.add_argument(
    "--verbose",
    action="store_true",
    help="Print a lot more stuff (for debugging)",
)

# Command line arguments parsing

args = parser.parse_args()

server_address = (args.server_host, args.server_port)

if args.write_raw is not None:
    raw_out_file = args.write_raw
else:
    raw_out_file = None

if args.write is not None:
    out_file = args.write
else:
    out_file = None

try:
    codec_info_in = codecs.lookup(args.encoding_in)
except LookupError:
    terminate("Unknown input encoding", args.encoding_in)

if args.verbose:
    trace = print
else:
    trace = lambda *_: ...


def receive_logs_persist():
    print("Waiting to connect...")
    last_attempt_duration = None
    while True:
        trace("last_attempt_duration =", last_attempt_duration)
        # limit connection attempts to once per 5 seconds
        if last_attempt_duration is not None and last_attempt_duration < 5:
            time.sleep(5 - last_attempt_duration)
        last_attempt_start = time.time()
        s = socket.socket()
        # retry every 5 seconds
        # (for some reason retrying helps the connection to be established?)
        s.settimeout(5.0)
        try:
            s.connect(server_address)
        except socket.timeout as e:
            trace(e)
        except ConnectionRefusedError as e:
            print(e)
            print(
                "If you are using WSL, you may need to pass your local ip address with --server-host"
            )
        except ConnectionError as e:
            print(e)
        else:
            print("Connected!")
            # put socket back in blocking mode
            s.settimeout(None)
            receive_data_write_files(s)
        last_attempt_duration = time.time() - last_attempt_start


def receive_logs_once():
    print("Waiting to connect...")
    s = socket.socket()
    s.connect(server_address)
    print("Connected!")
    receive_data_write_files(s)


def receive_data_write_files(s):
    raw_out_f = None
    raw_out = None
    out_f = None
    out = None
    try:
        if raw_out_file is not None:
            raw_out_f = open(raw_out_file, "wb")
            def raw_out(data):
                raw_out_f.write(data)
                raw_out_f.flush()

        if out_file is not None:
            out_f = open(out_file, "w")
            def out(data):
                out_f.write(data)
                out_f.flush()

        receive_data(s, raw_out, out)
    finally:
        if raw_out_f is not None:
            raw_out_f.close()
        if out_f is not None:
            out_f.close()


def receive_data(s, raw_out=None, out=None):
    dec_in = codec_info_in.incrementaldecoder()
    dataStr = ""
    while True:
        try:
            dataStrBytes = s.recv(4096)
        except ConnectionResetError as e:
            print(e)
            return
        trace("dataStrBytes =", dataStrBytes)
        # encoding doesn't matter as long as it includes ASCII, only sending numbers and commas
        dataStr += dataStrBytes.decode("utf-8")  # += "1,2,3,"
        trace("dataStr =", dataStr)
        bytesStr = dataStr.split(",")  # = ["1", "2", "3", ""]
        trace("bytesStr =", bytesStr)
        dataStr = bytesStr[-1]  # = ""
        trace("dataStr =", dataStr)

        # dataStr may only be a (possibly partial) integer in 0-255 range, without a trailing comma
        # e.g. "0", "5", "42", "255"
        if len(dataStr) > 3:
            print(
                "Expected the server to send comma-separated integers (like '1,2,3'), instead getting:"
            )
            print(dataStr)
            print("Make sure you are using the right server script!")
            terminate()

        try:
            data = bytes(int(byteStr) for byteStr in bytesStr[:-1])  # = [1, 2, 3]
        except ValueError as e:
            trace(e)
            print(
                "Expected all of these strings to be base 10 integers, but at least one is not:"
            )
            print(bytesStr)
            print("Make sure you are using the right server script!")
            terminate()
        trace("data =", data)

        if raw_out is not None:
            raw_out(data)

        try:
            text = dec_in.decode(data)
        except ValueError as e:  # decoding error
            # FIXME this resets the decoder state so some of the buffer may be lost.
            # at least it doesn't break the script I guess
            print("Decoding error")
            print(e)
            continue

        if out is not None:
            out(text)

        sys.stdout.write(text)


try:
    if args.persist:
        receive_logs_persist()
    else:
        receive_logs_once()
except KeyboardInterrupt:
    print()
