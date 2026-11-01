=== enter_lobby ===
~ location = "lobby"
~ lobby_seen = true
{ not met:
    ~ met = true
    ~ phase = 1
    # cue:location:lobby
    # voice:hello
    旧店最后营业夜。米拉从打包纸箱旁抬起头，给你留出一个位置。
- else:
    # cue:location:lobby
    {lobby_seen:回到大堂，刚才的话题还没有说完。|吧台与走廊都还亮着灯，你们可以慢慢看看。}
}
-> menu
