"""X11 helper for npm run desktop:smoke on Linux (under Xvfb): find FITRON's window, close it the way a user does (the
window manager's WM_DELETE_WINDOW request), take a screenshot. Windows uses its own tools (taskkill sends WM_CLOSE).

  python3 x11.py names                 window names, one per line
  python3 x11.py close "<name>"        ask every window with that name to close; prints how many
  python3 x11.py shot <file.png>       the whole screen
"""

import sys

from Xlib import X, display, protocol


def windows(d):
    out = []

    def walk(w):
        try:
            name = w.get_wm_name()
            if name is None:
                net = w.get_full_property(d.intern_atom("_NET_WM_NAME"), d.intern_atom("UTF8_STRING"))
                name = net.value.decode("utf-8", "replace") if net else None
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            if name:
                out.append((w, name))
            for c in w.query_tree().children:
                walk(c)
        except Exception:
            pass

    walk(d.screen().root)
    return out


def main():
    d = display.Display()
    cmd = sys.argv[1]
    if cmd == "names":
        for _, name in windows(d):
            print(name)
    elif cmd == "close":
        wm_protocols = d.intern_atom("WM_PROTOCOLS")
        wm_delete = d.intern_atom("WM_DELETE_WINDOW")
        n = 0
        for w, name in windows(d):
            if name == sys.argv[2]:
                ev = protocol.event.ClientMessage(window=w, client_type=wm_protocols, data=(32, [wm_delete, X.CurrentTime, 0, 0, 0]))
                w.send_event(ev, event_mask=X.NoEventMask)
                n += 1
        d.flush()
        print(n)
    elif cmd == "shot":
        from PIL import Image

        root = d.screen().root
        g = root.get_geometry()
        raw = root.get_image(0, 0, g.width, g.height, X.ZPixmap, 0xFFFFFFFF)
        Image.frombytes("RGB", (g.width, g.height), raw.data, "raw", "BGRX").save(sys.argv[2])
        print(sys.argv[2])
    else:
        raise SystemExit(f"unknown command {cmd}")


main()
