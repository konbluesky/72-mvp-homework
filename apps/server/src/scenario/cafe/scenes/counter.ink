=== enter_counter ===
~ location = "counter"
~ shot_location = "counter"
~ shot_mode = "shared"
~ beat = "first-counter"
~ phase = 2
# cue:location:counter
吧台上摆着饮品单，收银台旁留着放杯碟的位置。你可以看看喝的东西，也可以继续刚才的话题。
-> menu

=== inspect_menu ===
~ menu_read = true
# cue:prop:menu
公开的饮品单在眼前展开。看过菜单，还没有发生点单或结账。
-> menu
