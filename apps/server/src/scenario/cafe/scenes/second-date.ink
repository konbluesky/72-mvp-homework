=== start_second_date ===
~ ambience = "closed"
# cue:ambience:closed
第一晚的灯光收束，故事准备转向另一个双方确认有空的雨夜。
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
~ second_date = true
~ ending = ""
~ phase = 1
~ beat = "b01-1"
# cue:location:cafe-front
另一个雨夜，你们如约在已关闭的旧店门前碰头。
~ rain_softened = false
# cue:environment:rain
同一条街又下起雨，雨线在路灯下亮起来。
-> menu

=== node_b01_1 ===
~ beat = "b01-2"
# cue:beat:b01-1
{overnight:
# voice:reunionNight
她在旧店门前叫住你，笑意比招呼更早。
- else:
{boundary_set && not boundary_repaired:
# voice:reunionSlower
她在旧店门前叫住你，笑意比招呼更早。
- else:
# voice:long_b01_1
# thought:reunion-spark
她在旧店门前叫住你，笑意比招呼更早。
}
}
-> menu

=== node_b01_2 ===
~ beat = "b01-3"
# cue:beat:b01-2
# voice:long_b01_2
她承认期待时，没有立刻用别的话盖住。
-> menu

=== node_b01_3 ===
~ beat = "b01-4"
# cue:beat:b01-3
# voice:long_b01_3
关闭的营业牌在两人身旁轻轻晃了一下。
-> menu

=== node_b01_4 ===
~ beat = "b01-5"
# cue:beat:b01-4
# voice:long_b01_4
她给这次见面留出熟悉，也留出空间。
-> menu

=== node_b01_5 ===
~ beat = "b02-1"
# cue:beat:b01-5
# voice:long_b01_5
她往雨棚里面让了半步，把话题交还给你。
-> menu

=== node_b02_1 ===
~ beat = "b02-2"
# cue:beat:b02-1
{overnight:
# voice:memoryNight
她没有急着从记忆里挑一句最漂亮的话。
- else:
{game_answered:
# voice:memoryGameLong
她没有急着从记忆里挑一句最漂亮的话。
- else:
{makeup_returned:
# voice:memoryWait
她没有急着从记忆里挑一句最漂亮的话。
- else:
# voice:long_b02_1
她没有急着从记忆里挑一句最漂亮的话。
}
}
}
-> menu

=== node_b02_2 ===
~ beat = "b02-3"
# cue:beat:b02-2
# voice:long_b02_2
# thought:reunion-quiet
她笑了一下，这次没把承认收回去。
-> menu

=== node_b02_3 ===
~ beat = "b02-4"
# cue:beat:b02-3
# voice:long_b02_3
她给不同的记忆留出同样认真的位置。
-> menu

=== node_b02_4 ===
~ beat = "b02-5"
# cue:beat:b02-4
# voice:long_b02_4
门前的雨声里，她的声音没有再刻意放轻。
-> menu

=== node_b02_5 ===
~ beat = "b03-1"
# cue:beat:b02-5
# voice:long_b02_5
你们从门头的暖光边缘走向街道。
-> menu

=== node_b03_1 ===
~ location = "street-walk"
~ shot_location = "street-walk"
~ shot_mode = "shared"
# cue:location:street-walk
你们沿店外街道慢慢走，雨线在路灯下变得清楚。
~ beat = "b03-2"
# cue:beat:b03-1
# voice:long_b03_1
她绕过一块湿砖，停半步等你。
-> menu

=== node_b03_2 ===
~ beat = "b03-3"
# cue:beat:b03-2
# voice:long_b03_2
她讲起小计划时，语气比谈论关系轻松。
-> menu

=== node_b03_3 ===
~ beat = "b03-4"
# cue:beat:b03-3
# voice:long_b03_3
她听完你的看法，没有急着寻找一样的答案。
-> menu

=== node_b03_4 ===
~ beat = "b03-5"
# cue:beat:b03-4
# voice:long_b03_4
她把一件平常的习惯，说成了可以共同理解的事。
-> menu

=== node_b03_5 ===
~ beat = "b04-1"
# cue:beat:b03-5
# voice:long_b03_5
街道没有催促两个人抵达什么地方。
-> menu

=== node_b04_1 ===
~ beat = "b04-2"
# cue:beat:b04-1
# voice:long_b04_1
她停在路灯附近，把这一句说得很稳。
-> menu

=== node_b04_2 ===
~ beat = "b04-3"
# cue:beat:b04-2
# voice:long_b04_2
她没有把这句话说成一道必须过关的题。
-> menu

=== node_b04_3 ===
~ beat = "b04-4"
# cue:beat:b04-3
# voice:long_b04_3
她把不确定和敷衍分开，没有替你选择。
-> menu

=== node_b04_4 ===
~ beat = "b04-5"
# cue:beat:b04-4
# voice:long_b04_4
# thought:honesty
她承认自己也有没准备好的地方。
-> menu

=== node_b04_5 ===
~ beat = "b04-6"
# cue:beat:b04-5
# voice:long_b04_5
谈话有了重量，却没有变成指责。
-> menu

=== node_b04_6 ===
~ beat = "b05-1"
# cue:beat:b04-6
# voice:long_b04_6
她把步子放慢，允许这一段话暂时停在这里。
-> menu

=== node_b05_1 ===
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
# cue:location:cafe-front
你们走回旧店门前，关闭的玻璃门映着两人的轮廓。
~ beat = "b05-2"
# cue:beat:b05-1
# voice:long_b05_1
玻璃后的桌面已经空了，外面的两个人叠在倒影上。
-> menu

=== node_b05_2 ===
~ beat = "b05-3"
# cue:beat:b05-2
# voice:long_b05_2
# thought:window-return
她低头整理随身的小东西，没有马上接下一句。
-> menu

=== node_b05_3 ===
~ beat = "b05-4"
# cue:beat:b05-3
# voice:long_b05_3
她重新望向你，这次没有用玩笑挡住停顿。
-> menu

=== node_b05_4 ===
~ beat = "b06-1"
# cue:beat:b05-4
# voice:long_b05_4
那段沉默没有被匆忙填平，也没有留下谁被冷落在原处。
-> menu

=== node_b06_1 ===
~ location = "street-walk"
~ shot_location = "street-walk"
~ shot_mode = "shared"
# cue:location:street-walk
话题重新有了声音，你们沿街继续往前走。
~ beat = "b06-2"
# cue:beat:b06-1
# voice:long_b06_1
她把自己的不足放到可以谈的位置。
-> menu

=== node_b06_2 ===
~ beat = "b06-3"
# cue:beat:b06-2
# voice:long_b06_2
这次她没有把被理解说成对方一个人的责任。
-> menu

=== node_b06_3 ===
~ beat = "b06-4"
# cue:beat:b06-3
# voice:long_b06_3
她说的是具体的相处，没有要求一个永远。
-> menu

=== node_b06_4 ===
~ beat = "b06-5"
# cue:beat:b06-4
# voice:long_b06_4
她没有把某一种关系形式当成唯一正确的答案。
-> menu

=== node_b06_5 ===
~ beat = "b06-6"
# cue:beat:b06-5
# voice:long_b06_5
她说到洒脱时，自己先轻轻笑了一下。
-> menu

=== node_b06_6 ===
~ beat = "b07-1"
# cue:beat:b06-6
# voice:long_b06_6
# thought:closer
她把那点高兴说出来，没有准备一个退回去的借口。
-> menu

=== node_b07_1 ===
~ beat = "b07-2"
# cue:beat:b07-1
{boundary_set && not boundary_repaired:
# voice:friendlyCloseness
她记得你想慢一点，继续保持舒服的距离。
- else:
# voice:long_b07_1
她没有先缩短距离，而是等你把意思说清。
}
-> menu

=== node_b07_2 ===
~ beat = "b07-3"
# cue:beat:b07-2
# voice:long_b07_2
路灯下的距离，仍然由两个人一起决定。
-> menu

=== node_b07_3 ===
~ beat = "b07-4"
# cue:beat:b07-3
# voice:long_b07_3
她放松下来，没有把拒绝当成需要挽回的冷场。
-> menu

=== node_b07_4 ===
~ beat = "b08-1"
# cue:beat:b07-4
# voice:long_b07_4
这一次，没有人急着用玩笑替真正的问题收尾。
-> menu

=== node_b08_1 ===
~ beat = "b08-2"
# cue:beat:b08-1
# voice:long_b08_1
路口就在前面，她停下来听你。
-> menu

=== node_b08_2 ===
~ beat = "b08-3"
# cue:beat:b08-2
# voice:long_b08_2
她说的是下一段路，没有替你画完整张地图。
-> menu

=== node_b08_3 ===
~ beat = "b08-4"
# cue:beat:b08-3
# voice:long_b08_3
她给这两次相遇留下完整的分量。
-> menu

=== node_b08_4 ===
~ beat = "b08-5"
# cue:beat:b08-4
# voice:long_b08_4
她的声音没有催促，选择却终于不再模糊。
-> menu

=== node_b08_5 ===
~ beat = "b-ending"
# cue:beat:b08-5
# voice:long_b08_5
路灯依旧亮着，第二次告别有了自己的答案。
-> menu

=== choose_hand ===
~ handheld = true
~ contact_kind = "牵手"
# cue:beat:choose-hand
# voice:hand
她明确答应以后，两只手轻轻相触，路还可以慢慢走。
-> menu

=== choose_hug ===
~ contact_kind = "拥抱"
# cue:beat:choose-hug
# voice:hugConsent
双方都愿意，才走近拥抱。停留片刻以后，你们重新望向同一条街。
-> menu

=== choose_kiss ===
~ contact_kind = "短暂亲吻"
# cue:beat:choose-kiss
# voice:kissConsent
她也明确愿意，你们短暂地吻了一下，随后留出各自舒服的距离。
-> menu

=== finish_closer ===
~ ending = "closer"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:closer
# voice:dateClose
《普通日子，也想见你》：没有提前保证永远，但都愿意给下一次一个位置。
-> menu

=== finish_casual ===
~ ending = "casual"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:casual
# voice:casualEnd
《轻松，也说清楚》：期待不藏在另一种关系的名字后面。
-> menu

=== finish_friends ===
~ ending = "friends"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:friends
# voice:dateFriends
《好好认识过》：路口的告别没有将过去的开心改写成错误。
-> menu

=== finish_farewell ===
~ ending = "farewell"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:farewell
# voice:farewellEnd
《到这里，也认真》：两个人都知道对方认真站在这里过。
-> menu

=== date_pause ===
~ date_finished = true
~ ending = "pause"
~ phase = 3
~ beat = "finished"
# cue:ending:pause
# voice:pauseEnd
《先说晚安》：没谈完的话没有作废，今晚也可以先到这里。
-> menu
