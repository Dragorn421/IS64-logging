import socket
import sys

base_excepthook = sys.excepthook


def excepthook(*args):
    base_excepthook(*args)
    input("Press enter to exit...")


sys.excepthook = excepthook


# The PJ64 API is really finicky, doesn't hurt having quick debugging available
_debug = False


def debug(*args):
    global _debug
    if _debug:
        print(*args)


s = socket.socket()
print("Waiting to connect...")
s.connect(("127.0.0.1", 411))
print("Connected!")
dataStr = ""
data = bytes()
while True:
    # encoding doesn't matter as long as it includes ASCII, only sending numbers and commas
    dataStr += s.recv(1000).decode("utf-8")  # += "1,2,3,"
    debug("dataStr =", dataStr)
    bytesStr = dataStr.split(",")  # = ["1", "2", "3", ""]
    debug("bytesStr =", bytesStr)
    data += bytes(int(byteStr) for byteStr in bytesStr[:-1])  # += [1, 2, 3]
    debug("data =", data)
    dataStr = bytesStr[-1]  # = ""
    debug("dataStr =", dataStr)

    for i in range(len(data)):
        j = len(data) - i
        debug("i =", i, "j =", j)
        try:
            debug("data[:j] =", data[:j])
            text = data[:j].decode("euc-jp")
            debug("text =", text)
            print(text, end="")
            sys.stdout.flush()
            data = data[j:]
            break
        except UnicodeDecodeError:
            debug("UnicodeDecodeError j=", j)
            pass
