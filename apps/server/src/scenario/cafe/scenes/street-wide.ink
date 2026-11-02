=== enter_street_wide ===
~ location = "street-wide"
~ shot_location = "street-wide"
~ shot_mode = "shared"
{not met && ending == "":
    ~ beat = "arrival-street"
}
# cue:location:street-wide
{not met:街角的雨还在下。那家咖啡馆的灯亮着，隔着玻璃，看不清里面的人。|{second_date:同一条街，另一个雨夜。店已经搬走，你们却因为约定再次回来。|{ambience == "closed":旧店招牌暗下去，街角仍有路灯。这个晚上留下了什么，由已经说过的话决定。|街角的暖光落在湿路面上。有人来躲雨，也有人会找到多待一会儿的理由。}}}
-> menu
