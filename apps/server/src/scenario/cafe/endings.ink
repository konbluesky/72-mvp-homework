=== ending_depart ===
~ location = "cafe-front"
# cue:location:cafe-front
# voice:storyDepart
你们从店内的暖光走到门头。檐下滴水，刚才没说完的话也跟着出来。
~ ambience = "closed"
# cue:ambience:closed
营业牌翻面，旧店的灯一盏盏暗下去。米拉回头看了一眼，再转向你。
~ location = "street-walk"
# cue:location:street-walk
{chemistry && (not boundary_set || boundary_repaired):
    # voice:leaveSpark
    走到路灯下，她偏过头，像是认真等一个答案，又像还准备着接你的下一句玩笑。
- else:
    # voice:leaveQuiet
    你们保持舒服的距离，安静走过一段街道。
}
~ rain_softened = true
# cue:environment:rain-soft
雨势缓和，路面仍有暖色的反光。
~ ending = "depart"
~ phase = 3
# cue:ending:depart
{appointment:《下次，不等雨》：今晚先走到这里，另一次专门的见面已经约好。|《不在航线上的一晚》：这一段路没有预定目的地，走过时却没有觉得浪费。}
-> menu

=== ending_letter ===
~ location = "counter"
# cue:location:counter
# voice:storyLetter
她回到吧台，用一张便笺给今晚留下自己的落款。
~ reply_left = true
# cue:prop:reply
便笺放在托盘里，落款只有她的名字。窗边的灯把纸角照得暖了一点。
~ location = "cafe-front"
# cue:location:cafe-front
门前，你们好好说再见。
~ ambience = "closed"
# cue:ambience:closed
门牌翻为休息，檐下仍有滴水声。
~ ending = "letter"
~ phase = 3
# cue:ending:letter
《一句好好的晚安》：檐下的道别没有拖得很长，回头时却还有一个人愿意挥手。
-> menu

=== ending_stay ===
~ location = "window-seat"
# cue:location:window-seat
# voice:storyStay
你们回到窗边，多留一会儿。那些互相逗弄的话，也给真诚让出一个位置。
~ ambience = "last-lamp"
# cue:ambience:last-lamp
其他区域收了灯，窗边还留着一盏桌灯。
~ ending = "stay"
~ phase = 3
# cue:ending:stay
《今晚没有返程》：桌灯留下一小圈暖光。这一晚剩下的时间，暂时不用拿来赶路。
-> menu

=== early_goodnight ===
~ location = "cafe-front"
# cue:location:cafe-front
你来到门头。暖光还在玻璃后面，檐下的雨声比进门时清楚一些。
~ ending = "letter"
~ phase = 3
# cue:ending:letter
# voice:earlyGoodnight
《先说一声晚安》：这一段相遇，到这里也可以刚刚好。
-> menu
