=== early_goodnight ===
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:shot:shared:cafe-front
镜头回到门前。你们决定先结束这一晚。
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:location:cafe-front
你来到门头，暖光仍留在玻璃后面。
~ first_ending = "letter"
~ ending = "letter"
~ phase = 3
~ beat = "a-closed"
# cue:ending:letter
# voice:earlyGoodnight
《先说一声晚安》：相遇可以在这里停下，不欠一段必须走完的剧情。
-> menu

=== ending_depart ===
~ location = "street-walk"
~ shot_location = "street-walk"
~ shot_mode = "shared"
# cue:location:street-walk
你们沿着旧店外的街道，再走一段不必赶路的路。
~ ambience = "closed"
# cue:ambience:closed
门牌翻面，旧店的灯光收束。
~ rain_softened = true
# cue:environment:rain-soft
雨势缓和，路面仍映着路灯。
~ ending = "depart"
~ first_ending = "depart"
~ phase = 3
~ beat = "a-closed"
# cue:ending:depart
# voice:storyDepart
《先欠下一次》：道别没有把刚才认真说过的话收回去。
-> menu

=== ending_letter ===
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:location:cafe-front
你们在门前停下，给这一晚一句好好的晚安。
~ ending = "letter"
~ first_ending = "letter"
~ phase = 3
~ beat = "a-closed"
# cue:ending:letter
# voice:storyLetter
《一句好好的晚安》：不需要用承诺证明这个晚上值得记住。
-> menu

=== ending_stay ===
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:location:window-seat
你们回到窗边，在最后一盏灯下多留片刻。
~ ambience = "last-lamp"
# cue:ambience:last-lamp
其他区域收了灯，桌灯留下小小一圈暖光。
~ ending = "stay"
~ first_ending = "stay"
~ phase = 3
~ beat = "a-closed"
# cue:ending:stay
# voice:storyStay
《今晚没有返程》：这一晚在灯下收束，想再见仍需另一个明确约定。
-> menu

=== offer_night ===
~ night_offer = true
~ beat = "night-confirm"
# cue:beat:night-offer
# voice:nightOffer
她说清自己愿意的选择，没有提前替你迈出下一步。
-> menu

=== decline_night ===
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:shot:shared:cafe-front
镜头回到门前。你们把选择停在此刻，不再继续那段留白。
~ night_offer = false
~ beat = "a-ending"
# cue:beat:night-declined
# voice:nightDecline
你们决定先停下来。这一晚仍然可以用散步或道别收尾。
-> menu

=== spend_night ===
~ shot_location = "cafe-front"
~ shot_mode = "blackout"
# cue:shot:blackout:cafe-front
你们一起离开旧店的那圈暖光，画面淡出，把私密的时间留在故事之外。
~ overnight = true
~ night_offer = false
~ ending = "overnight"
~ first_ending = "overnight"
~ phase = 3
~ beat = "a-closed"
# cue:ending:overnight
《这一夜，不是误会》：那一夜，两个人都知道是彼此清醒作出的选择；它没有被写成关于以后的保证。
-> menu

=== make_appointment ===
~ appointment = true
# cue:prop:appointment
{overnight:
# voice:nightLater
- else:
# voice:v3Appointment
}
新的约定便笺展开。另一次见面来自双方愿意，不是已经亲近过便自动续上的义务。
-> menu
