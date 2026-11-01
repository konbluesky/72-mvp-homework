=== node_a01_1 ===
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:location:window-seat
她邀你坐到窗边，桌灯照出两个人可以慢慢说话的一小片地方。
~ companionship = true
~ beat = "a01-2"
# cue:beat:a01-1
# voice:long_a01_1
# thought:company
她抬眼看你，把那句提醒说得像一句邀请。
-> menu

=== node_a01_2 ===
~ beat = "a01-3"
# cue:beat:a01-2
# voice:long_a01_2
门外的雨声隔在玻璃另一侧。她把注意力留给你。
-> menu

=== node_a01_3 ===
~ beat = "a01-4"
# cue:beat:a01-3
# voice:long_a01_3
她先拿自己开了个玩笑，没有催你交代什么。
-> menu

=== node_a01_4 ===
~ beat = "a02-1"
# cue:beat:a01-4
# voice:long_a01_4
她说完停下来，给沉默也留了一个座位。
-> menu

=== node_a02_1 ===
~ beat = "a02-2"
# cue:beat:a02-1
# voice:long_a02_1
她看了一眼杯沿，又看向窗外。
-> menu

=== node_a02_2 ===
~ beat = "a02-3"
# cue:beat:a02-2
# voice:long_a02_2
她没有给你的心情下结论，只把自己的猜测放在桌上。
-> menu

=== node_a02_3 ===
~ game_played = true
~ beat = "a02-4"
# cue:beat:a02-3
# voice:long_a02_3
她微微扬起眉，像在等你发现破绽。
-> menu

=== node_a02_4 ===
~ game_answered = true
~ beat = "a02-5"
# cue:beat:a02-4
# voice:long_a02_4
谜底揭开，她笑了一下，没急着避开目光。
-> menu

=== node_a02_5 ===
~ beat = "a02-6"
# cue:beat:a02-5
# voice:long_a02_5
她把出题的机会交给你。
-> menu

=== node_a02_6 ===
~ beat = "a03-1"
# cue:beat:a02-6
# voice:long_a02_6
桌上的咖啡凉了一点，谈话却没有跟着冷下来。
-> menu

=== node_a03_1 ===
~ location = "photo-corridor"
~ shot_location = "photo-corridor"
~ shot_mode = "shared"
# cue:location:photo-corridor
你们走到照片墙前，近处的海报和空相框留下的浅痕映在暖光里。
~ beat = "a03-2"
# cue:beat:a03-1
# voice:long_a03_1
她邀你走近走廊，没有把告别说得太沉重。
-> menu

=== node_a03_2 ===
~ beat = "a03-3"
# cue:beat:a03-2
# voice:long_a03_2
海报上的两个名字还在暖光里。
-> menu

=== node_a03_3 ===
~ beat = "a03-4"
# cue:beat:a03-3
# voice:long_a03_3
她讲起海边时，语气比介绍职业更松一些。
-> menu

=== node_a03_4 ===
~ beat = "a04-1"
# cue:beat:a03-4
# voice:long_a03_4
走廊安静下来，窗边的谈话声远了一些。
-> menu

=== node_a04_1 ===
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:location:window-seat
你们回到窗边，把没有接完的话放回一张桌子的距离。
~ beat = "a04-2"
# cue:beat:a04-1
# voice:long_a04_1
她收起一点玩笑，认真等你。
-> menu

=== node_a04_2 ===
~ beat = "a04-3"
# cue:beat:a04-2
# voice:long_a04_2
她没有否认吸引，只是把问题说得更具体。
-> menu

=== node_a04_3 ===
~ beat = "a04-4"
# cue:beat:a04-3
# voice:long_a04_3
她说起分寸时，仍然给不同意见留着空间。
-> menu

=== node_a04_4 ===
~ beat = "a04-5"
# cue:beat:a04-4
# voice:long_a04_4
她承认自己的那一点先入为主。
-> menu

=== node_a04_5 ===
~ trust = true
~ phase = 2
~ beat = "a05-1"
# cue:beat:a04-5
# voice:long_a04_5
# thought:off-duty
她停了一会儿，终于也讲了自己的那一份。
-> menu

=== node_a05_1 ===
{wait_nearby:
~ location = "photo-corridor"
~ shot_location = "photo-corridor"
~ shot_mode = "shared"
# cue:location:photo-corridor
你表示愿意在附近看看照片墙，米拉知道回来时可以在这里找到你。
- else:
~ location = "window-seat"
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:location:window-seat
你表示愿意留在窗边等候，米拉记住了这个位置。
}
~ beat = "a05-2"
# cue:beat:a05-1
# voice:long_a05_1
她起身前，又看了眼你所在的位置。
-> menu

=== node_a05_2 ===
~ shot_location = "washroom"
~ shot_mode = "character"
~ beat = "a05-3"
# cue:shot:character:washroom
# thought:mirror-check
镜头跟随米拉来到公共洗手区。玩家仍留在原处。她先看了眼镜中的表情，才拿出随身的补妆用品。
-> menu

=== node_a05_3 ===
~ beat = "a05-4"
# cue:beat:a05-3
# thought:mirror-smile
唇色只需要轻轻补一下，她却检查了两次。门外的雨声很远，她试了试刚才那种漫不经心的笑，发现没那么容易装回去。
-> menu

=== node_a05_4 ===
~ beat = "a06-1"
# cue:beat:a05-4
# thought:mirror-return
她收起补妆的东西，最后看了一眼镜子。不是突然想好了所有事情，只是决定回去时，不再先用一句玩笑把自己藏起来。
-> menu

=== node_a06_1 ===
{wait_nearby:
~ shot_location = "photo-corridor"
~ shot_mode = "shared"
# cue:shot:shared:photo-corridor
她从洗手区回来，在走廊找到等候的你。
- else:
~ shot_location = "window-seat"
~ shot_mode = "shared"
# cue:shot:shared:window-seat
镜头回到座位，她从门外走回来，先看见了仍愿意等候的你。
}
~ makeup_returned = true
~ beat = "a06-2"
# cue:beat:a06-1
{wait_nearby:
# voice:returnGallery
她回来时先找到你的身影，才笑着开口。
- else:
# voice:long_a06_1
她回来时先找到你的身影，才笑着开口。
}
-> menu

=== node_a06_2 ===
~ beat = "a06-3"
# cue:beat:a06-2
# voice:long_a06_2
她这回没有急着拿别的话岔开。
-> menu

=== node_a06_3 ===
~ chemistry = true
~ beat = "a06-4"
# cue:beat:a06-3
# voice:long_a06_3
# thought:spark
她没有躲开目光，笑意却比刚才柔和。
-> menu

=== node_a06_4 ===
~ beat = "a06-5"
# cue:beat:a06-4
# voice:long_a06_4
这一次，她把留下的理由说得很清楚。
-> menu

=== node_a06_5 ===
~ beat = "a07-1"
# cue:beat:a06-5
# voice:long_a06_5
窗边重新安静下来，这次的安静却熟悉一些。
-> menu

=== node_a07_1 ===
~ location = "counter"
~ shot_location = "counter"
~ shot_mode = "shared"
# cue:location:counter
你们走到吧台，托盘和写有米拉名字的旧信仍在暖光里。
~ beat = "a07-2"
# cue:beat:a07-1
# voice:long_a07_1
她望了望收起的桌椅，邀你一起走到吧台。
-> menu

=== node_a07_2 ===
~ beat = "a07-3"
# cue:beat:a07-2
# voice:long_a07_2
吧台暖光落在她停下来的那一瞬。
-> menu

=== node_a07_3 ===
~ beat = "a07-4"
# cue:beat:a07-3
# voice:long_a07_3
她听完，没有立刻把期待藏进玩笑里。
-> menu

=== node_a07_4 ===
~ beat = "a08-1"
# cue:beat:a07-4
# voice:long_a07_4
她在离开吧台前，把这句话留得很稳。
-> menu

=== node_a08_1 ===
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:location:cafe-front
你们来到雨棚下，门内的暖光隔在玻璃另一边。
~ beat = "a08-2"
# cue:beat:a08-1
# voice:long_a08_1
店门合上，室内暖光隔在玻璃之后。
-> menu

=== node_a08_2 ===
~ beat = "a08-3"
# cue:beat:a08-2
# voice:long_a08_2
檐下的滴水声把两句话之间的停顿放大。
-> menu

=== node_a08_3 ===
~ beat = "a08-4"
# cue:beat:a08-3
# voice:long_a08_3
她看着你，没替你补上后半句话。
-> menu

=== node_a08_4 ===
~ beat = "a-ending"
# cue:beat:a08-4
# voice:long_a08_4
她没有先迈向任何一边，给这一晚留出真正的分岔。
-> menu

=== skip_game ===
~ beat = "a02-5"
# cue:beat:game-skipped
# voice:quietChat
她接受跳过猜题，把好奇留给你愿意分享的部分。
-> menu

=== wait_gallery ===
~ wait_nearby = true
-> node_a05_1

=== friendly_return ===
~ boundary_set = true
~ boundary_repaired = false
~ beat = "a06-4"
# cue:beat:friendly-return
# voice:friendlyReturn
她接住了普通相处的意愿，把心动的话留在尚未说出口的地方。
-> menu
