=== enter_lobby ===
~ location = "lobby"
~ shot_location = "lobby"
~ shot_mode = "shared"
{not met:
    ~ met = true
    ~ phase = 1
    ~ beat = "first-greeting"
    # cue:location:lobby
    门铃响起，暖气和咖啡香扑过来。几把椅子已经倒扣，搬迁纸箱靠在吧台旁。窗边的女人循声抬头，见你在找空位，迟疑了一下，才指了指对面的椅子。
    # cue:beat:first-greeting
    # voice:hello
    她的招呼很轻，像是先确认你愿不愿意回应。坐不坐下，仍由你决定。
- else:
    # cue:location:lobby
    桌椅已经收起一些，窗边和走廊仍亮着灯。你们的话题跟着回来，没有重新变成陌生人。
}
-> menu
