=== sit_together ===
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
~ companionship = true
~ beat = "first-small-talk"
# cue:location:window-seat
你接受空位的邀请，在桌子的另一侧坐下。雨声隔在玻璃外，双方还不熟悉。
-> menu

=== wait_at_seat ===
~ wait_nearby = false
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:location:window-seat
你选择在窗边等候，桌上仍放着各自的杯子。
-> prepare_makeup

=== wait_at_gallery ===
~ wait_nearby = true
~ location = "photo-corridor"
~ shot_location = "photo-corridor"
~ shot_mode = "shared"
# cue:location:photo-corridor
你选择在走廊看看风景画，她知道回来时可以在这里找到你。
-> prepare_makeup

=== prepare_makeup ===
# cue:beat:makeup-leave
# voice:makeupLeave
她说明自己要短暂离席。等候只是眼前的安排。
~ shot_location = "washroom"
~ shot_mode = "character"
~ beat = "first-mirror"
# cue:shot:character:washroom
{boundary_set && not boundary_repaired:
# thought:mirror-space
她在镜前整理妆容，把刚才的谈话暂时放下。玩家仍在原处。
- else:
{chemistry:
# thought:mirror-interest
她看了一眼镜中的表情，取出补妆用品。玩家仍在原处。
- else:
# thought:mirror-ordinary
她检查唇色，把纸巾折好。玩家仍在原处。
}
}
-> menu

=== finish_makeup ===
~ beat = "first-mirror-ready"
# cue:beat:makeup-ready
{chemistry && (not boundary_set || boundary_repaired):
# thought:mirror-ready-interest
她放下补妆用品，重新看了看镜中的自己。
- else:
# thought:mirror-ready
她收好东西，准备回到外面的座位。
}
-> menu

=== return_from_makeup ===
{wait_nearby:
~ shot_location = "photo-corridor"
~ shot_mode = "shared"
# cue:shot:shared:photo-corridor
她整理好妆容，回到你等候的走廊。
- else:
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:shot:shared:window-seat
她整理好妆容，回到窗边的座位。
}
~ makeup_returned = true
~ beat = "first-return"
# cue:beat:makeup-returned
她回到原处，谈话可以接着刚才的话题，也可以重新找个轻松的开头。
-> menu
