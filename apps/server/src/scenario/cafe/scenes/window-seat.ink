=== enter_window_seat ===
~ location = "window-seat"
# cue:location:window-seat
{letter_read:她把目光从空椅移回你。今晚，似乎还有别的可能。|窗边留着一张空椅，桌上放着海岸照片的封套。}
-> menu

=== hear_waiting ===
~ waiting_heard = true
# cue:beat:waiting
# voice:waiting
她望向雨窗，又转回来，愿意说说那位很久没见的朋友。
-> menu

=== offer_companionship ===
~ companionship = true
~ phase = 2
# cue:beat:companionship
# voice:comfort
她接受了你的陪伴。可以再聊一会儿，也可以慢慢想今晚接下来怎么过。
-> menu

=== view_photo ===
~ photo_seen = true
# cue:photo:travel_photo_01
# voice:photo
她拿出那张无人海岸的风景照片。可以聊旅行，也可以换一个话题。
{ view_mode == "conversation" && not rain_softened:
    ~ rain_softened = true
    # cue:environment:rain-soft
    # voice:rain
    雨窗上的水痕变得稀疏。她望向窗外，又轻轻看回你。
}
-> menu
