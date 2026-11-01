=== ending_depart ===
~ location = "cafe-front"
# cue:location:cafe-front
# voice:storyDepart
她选择主动出发，和你一起走到门头。
~ ambience = "closed"
# cue:ambience:closed
营业牌翻面，旧店的招牌缓缓暗下来。
~ location = "street-walk"
# cue:location:street-walk
你们走到路灯下，回望同一家店。
~ rain_softened = true
# cue:environment:rain-soft
雨势渐渐缓和，路面仍有暖色的反光。
~ ending = "depart"
~ phase = 3
# cue:ending:depart
《下一站，由我决定》：路还很长，你们仍可以继续聊。
-> menu

=== ending_letter ===
~ location = "counter"
# cue:location:counter
# voice:storyLetter
她回到吧台，想先留下一句话。
~ reply_left = true
# cue:prop:reply
{letter_read:回信放进托盘，回应了已经读过的邀请。|她留下自己的联系卡，没有假装已经知道那封信的内容。}
~ location = "cafe-front"
# cue:location:cafe-front
门前，她向你道别，感谢你陪她把这句话说完。
~ ambience = "closed"
# cue:ambience:closed
门牌翻为休息，檐下仍有滴水声。
~ ending = "letter"
~ phase = 3
# cue:ending:letter
《给未说出口的话》：今晚的决定已经留下，故事仍可以慢慢说。
-> menu

=== ending_stay ===
~ location = "window-seat"
# cue:location:window-seat
# voice:storyStay
你们回到窗边，没有急着为所有事情作答。
~ ambience = "last-lamp"
# cue:ambience:last-lamp
其他地方收了灯，窗边保留一盏桌灯。
~ ending = "stay"
~ phase = 3
# cue:ending:stay
《再坐一杯》：你们仍可以聊，雨也可以继续下。
-> menu
