=== enter_window_seat ===
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
~ beat = "first-personal"
# cue:location:window-seat
你们回到窗边。陶瓷杯仍在桌上，话题可以按彼此的兴致继续。
-> menu

=== hear_waiting ===
# cue:beat:waiting-question
她听见你问起是否在等人，准备回答。
-> menu

=== offer_companionship ===
~ companionship = true
# cue:beat:shared-table
你表示愿意坐下聊聊。共桌只代表眼前的相处。
-> menu

=== inspect_coffee ===
~ coffee_seen = true
# cue:prop:coffee
你看向桌上的陶瓷杯，杯口已经不冒热气。咖啡仍放在原处。
-> menu
