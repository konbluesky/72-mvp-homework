=== enter_lobby ===
~ location = "lobby"
{not met:
    ~ met = true
    # cue:location:lobby
    # voice:hello
    打包纸箱靠在吧台边。刚结束执勤的米拉抬起头，用一句带点玩笑的招呼邀请你坐下。
- else:
    # cue:location:lobby
    桌椅已经收起一些，窗边和走廊仍亮着灯。你们的话题跟着回来，没有重新变成陌生人。
}
-> menu
