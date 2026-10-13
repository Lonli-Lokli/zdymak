# duoctl-helper (vendored)

`duoctl-helper.m` is copied unchanged from [skarol/duoctl](https://github.com/skarol/duoctl)
(`skills/duoctl/scripts/duoctl-helper.m`, commit `efd5e3d`, 2026-10-07), under its MIT licence in
`LICENSE` beside it.

zdymak compiles it on first use (`src/capture/fold.mjs`) and runs it inside an iPhone Duo simulator
with `xcrun simctl spawn`, to send the hinge and orientation events Xcode's Device Hub sends. simctl
and devicectl have no command for either, and `devicectl device orientation set` reports success
and changes nothing.

To update it, copy the file again from a newer duoctl commit and change the commit above.
