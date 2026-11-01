VAR view_mode = "story"
VAR location = "lobby"
VAR ambience = "open"
VAR ending = ""
VAR phase = 1
VAR beat = "a01-1"
VAR shot_location = "lobby"
VAR shot_mode = "shared"
VAR wait_nearby = false
VAR night_offer = false
VAR first_ending = ""
VAR contact_kind = ""
VAR met = false
VAR companionship = false
VAR trust = false
VAR chemistry = false
VAR boundary_set = false
VAR boundary_repaired = false
VAR appointment = false
VAR second_date = false
VAR date_finished = false
VAR handheld = false
VAR photo_seen = false
VAR rain_softened = false
VAR notice_read = false
VAR exhibition_read = false
VAR letter_read = false
VAR reply_left = false
VAR game_played = false
VAR game_answered = false
VAR makeup_returned = false
VAR overnight = false
-> menu

INCLUDE scenes/street-wide.ink
INCLUDE scenes/cafe-front.ink
INCLUDE scenes/lobby.ink
INCLUDE scenes/window-seat.ink
INCLUDE scenes/photo-corridor.ink
INCLUDE scenes/washroom.ink
INCLUDE scenes/counter.ink
INCLUDE scenes/street-walk.ink
INCLUDE scenes/connection.ink
INCLUDE scenes/first-night.ink
INCLUDE scenes/second-date.ink
INCLUDE endings.ink

=== story_start ===
~ met = true
-> menu

=== conversation_start ===
~ view_mode = "conversation"
~ location = "window-seat"
~ shot_location = "window-seat"
~ beat = "legacy"
~ met = true
-> menu

=== menu ===
+ { view_mode == "story" && shot_mode == "shared" && location != "street-wide" } [街角远景 # action:move-street-wide ]
    -> enter_street_wide
+ { view_mode == "story" && shot_mode == "shared" && location != "cafe-front" } [门头雨棚 # action:move-cafe-front ]
    -> enter_cafe_front
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "lobby" } [入口大堂 # action:move-lobby ]
    -> enter_lobby
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "window-seat" } [窗边座位 # action:move-window-seat ]
    -> enter_window_seat
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "photo-corridor" } [照片墙走廊 # action:move-photo-corridor ]
    -> enter_photo_corridor
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "washroom" } [公共洗手区 # action:move-washroom ]
    -> enter_washroom
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "counter" } [吧台结账台 # action:move-counter ]
    -> enter_counter
+ { view_mode == "story" && shot_mode == "shared" && second_date && location != "street-walk" } [店外街道 # action:move-street-walk ]
    -> enter_street_walk
+ { met && shot_mode == "shared" && not second_date && ending == "" } [看看海岸照片 # action:view-photo ]
    -> view_photo
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "lobby" } [看看notice # action:inspect-notice ]
    -> inspect_notice
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "photo-corridor" } [看看exhibition # action:inspect-exhibition ]
    -> inspect_exhibition
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "counter" } [看看letter # action:inspect-letter # explicit ]
    -> inspect_letter
+ { view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "counter" && reply_left } [看看reply # action:inspect-reply ]
    -> inspect_reply
+ { view_mode == "conversation" && ending == "" && not second_date } [talk-waiting # action:talk-waiting ]
    -> hear_waiting
+ { view_mode == "conversation" && ending == "" && not companionship } [talk-companionship # action:talk-companionship ]
    -> offer_companionship
+ { view_mode == "conversation" && ending == "" && companionship && not trust } [talk-off-duty # action:talk-off-duty ]
    -> talk_off_duty
+ { view_mode == "conversation" && ending == "" && companionship && not chemistry && not boundary_set } [talk-spark # action:talk-spark # explicit ]
    -> talk_spark
+ { companionship && shot_mode == "shared" && ending == "" && (not boundary_set || boundary_repaired) } [先慢一点 # action:talk-boundary ]
    -> talk_boundary
+ { trust && boundary_set && not boundary_repaired && ending == "" && shot_mode == "shared" } [重新愿意约会 # action:talk-reopen # explicit ]
    -> talk_reopen
+ { view_mode == "story" && beat == "a01-1" && ending == "" } [我先坐一会儿，今晚也不急着走。 # action:talk-a01-1 ]
    -> node_a01_1
+ { view_mode == "story" && beat == "a01-2" && ending == "" } [这句开场倒让我想多坐一会儿。 # action:talk-a01-2 ]
    -> node_a01_2
+ { view_mode == "story" && beat == "a01-3" && ending == "" } [我想先听听你今天有什么好笑的小事。 # action:talk-a01-3 ]
    -> node_a01_3
+ { view_mode == "story" && beat == "a01-4" && ending == "" } [那就不交换完整履历，慢慢认识。 # action:talk-a01-4 ]
    -> node_a01_4
+ { view_mode == "story" && beat == "a02-1" && ending == "" } [这杯放凉的咖啡，还值得慢慢喝吗？ # action:talk-a02-1 ]
    -> node_a02_1
+ { view_mode == "story" && beat == "a02-2" && ending == "" } [听起来，你是在给自己找一个多留片刻的理由。 # action:talk-a02-2 ]
    -> node_a02_2
+ { view_mode == "story" && beat == "a02-3" && ending == "" } [来个小赌局吧，你出题，我认真猜。 # action:talk-a02-3 ]
    -> node_a02_3
+ { view_mode == "story" && beat == "a02-4" && ending == "" } [我猜第三句，你不太会说舍不得。 # action:talk-a02-4 ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-5" && ending == "" } [那这回换你认识我一点，不用一直让我猜。 # action:talk-a02-5 ]
    -> node_a02_5
+ { view_mode == "story" && beat == "a02-6" && ending == "" } [猜对猜错不重要，肯认真接话就挺有意思。 # action:talk-a02-6 ]
    -> node_a02_6
+ { view_mode == "story" && beat == "a03-1" && ending == "" } [我愿意陪你看看那面快拆走的照片墙。 # action:talk-a03-1 ]
    -> node_a03_1
+ { view_mode == "story" && beat == "a03-2" && ending == "" } [海报上另一个名字，对你一定也有段故事。 # action:talk-a03-2 ]
    -> node_a03_2
+ { view_mode == "story" && beat == "a03-3" && ending == "" } [我有一点好奇，但不想把你的过去当成竞争。 # action:talk-a03-3 ]
    -> node_a03_3
+ { view_mode == "story" && beat == "a03-4" && ending == "" } [原来你最怀念的，是不需要赶路的那段时间。 # action:talk-a03-4 ]
    -> node_a03_4
+ { view_mode == "story" && beat == "a04-1" && ending == "" } [我想认识工作之外的你，也想听听你的顾虑。 # action:talk-a04-1 ]
    -> node_a04_1
+ { view_mode == "story" && beat == "a04-2" && ending == "" } [第一眼会吸引我，但我不想只停在第一眼。 # action:talk-a04-2 ]
    -> node_a04_2
+ { view_mode == "story" && beat == "a04-3" && ending == "" } [你也可以直接告诉我，哪种玩笑会让你不舒服。 # action:talk-a04-3 ]
    -> node_a04_3
+ { view_mode == "story" && beat == "a04-4" && ending == "" } [那也请你别提前替我猜结局，我们公平一点。 # action:talk-a04-4 ]
    -> node_a04_4
+ { view_mode == "story" && beat == "a04-5" && ending == "" } [我们不用一直表现得完美，能把话重说一次就很好。 # action:talk-a04-5 ]
    -> node_a04_5
+ { view_mode == "story" && beat == "a05-1" && ending == "" } [你慢慢整理，我在原处等你。 # action:talk-a05-1 ]
    -> node_a05_1
+ { view_mode == "story" && beat == "a05-2" && ending == "" } [安静地等她，先不打扰。 # action:talk-a05-2 ]
    -> node_a05_2
+ { view_mode == "story" && beat == "a05-3" && ending == "" } [留一点独处的时间，等她自己回来。 # action:talk-a05-3 ]
    -> node_a05_3
+ { view_mode == "story" && beat == "a05-4" && ending == "" } [我仍愿意留下，把刚才的话聊完。 # action:talk-a05-4 ]
    -> node_a05_4
+ { view_mode == "story" && beat == "a06-1" && ending == "" } [我还在，刚才的话也想继续听。 # action:talk-a06-1 ]
    -> node_a06_1
+ { view_mode == "story" && beat == "a06-2" && ending == "" } [露馅也挺好，我更想认识不用装从容的你。 # action:talk-a06-2 ]
    -> node_a06_2
+ { view_mode == "story" && beat == "a06-3" && ending == "" && (not boundary_set || boundary_repaired) } [我对你有点心动，也想认真多认识一点。 # action:talk-a06-3 # explicit ]
    -> node_a06_3
+ { view_mode == "story" && beat == "a06-4" && ending == "" } [先不替这份心动写结局，继续聊眼前的事。 # action:talk-a06-4 ]
    -> node_a06_4
+ { view_mode == "story" && beat == "a06-5" && ending == "" } [普通一点也好，不必每句话都像告白。 # action:talk-a06-5 ]
    -> node_a06_5
+ { view_mode == "story" && beat == "a07-1" && ending == "" } [去吧台看看吧，这一晚也值得好好收尾。 # action:talk-a07-1 ]
    -> node_a07_1
+ { view_mode == "story" && beat == "a07-2" && ending == "" } [那下一杯可以留给我们另一次见面。 # action:talk-a07-2 ]
    -> node_a07_2
+ { view_mode == "story" && beat == "a07-3" && ending == "" } [我还想认识你，不只是想把今晚拖得更长。 # action:talk-a07-3 ]
    -> node_a07_3
+ { view_mode == "story" && beat == "a07-4" && ending == "" } [无论今晚怎么结束，都把彼此愿意的事说清楚。 # action:talk-a07-4 ]
    -> node_a07_4
+ { view_mode == "story" && beat == "a08-1" && ending == "" } [我们到雨棚下站一会儿，再决定往哪儿走。 # action:talk-a08-1 ]
    -> node_a08_1
+ { view_mode == "story" && beat == "a08-2" && ending == "" } [我不想拿顺路当借口，也不替你决定。 # action:talk-a08-2 ]
    -> node_a08_2
+ { view_mode == "story" && beat == "a08-3" && ending == "" } [不需要现在答应以后，我想听你真实愿意的选择。 # action:talk-a08-3 ]
    -> node_a08_3
+ { view_mode == "story" && beat == "a08-4" && ending == "" } [今晚我愿意认真作一个决定，也听你的回答。 # action:talk-a08-4 ]
    -> node_a08_4
+ { view_mode == "story" && beat == "b01-1" && ending == "" } [我今天是专门来见你的，不是刚好路过。 # action:talk-b01-1 ]
    -> node_b01_1
+ { view_mode == "story" && beat == "b01-2" && ending == "" } [我也有一点紧张，不过愿意把真实的自己带来。 # action:talk-b01-2 ]
    -> node_b01_2
+ { view_mode == "story" && beat == "b01-3" && ending == "" } [不用把上次当成一份已经写好的关系说明。 # action:talk-b01-3 ]
    -> node_b01_3
+ { view_mode == "story" && beat == "b01-4" && ending == "" } [今天仍按彼此舒服的速度相处。 # action:talk-b01-4 ]
    -> node_b01_4
+ { view_mode == "story" && beat == "b01-5" && ending == "" } [我们先聊聊上次真正记住的那个瞬间吧。 # action:talk-b01-5 ]
    -> node_b01_5
+ { view_mode == "story" && beat == "b02-1" && ending == "" } [你先说吧，我想听听你真正记住了什么。 # action:talk-b02-1 ]
    -> node_b02_1
+ { view_mode == "story" && beat == "b02-2" && ending == "" } [那也给当时没说出口的话一个位置。 # action:talk-b02-2 ]
    -> node_b02_2
+ { view_mode == "story" && beat == "b02-3" && ending == "" } [我记住的可能不一样，但也愿意说给你听。 # action:talk-b02-3 ]
    -> node_b02_3
+ { view_mode == "story" && beat == "b02-4" && ending == "" } [有些话当时像玩笑，后来才觉得认真。 # action:talk-b02-4 ]
    -> node_b02_4
+ { view_mode == "story" && beat == "b02-5" && ending == "" } [那今天少一点猜，沿着街慢慢走吧。 # action:talk-b02-5 ]
    -> node_b02_5
+ { view_mode == "story" && beat == "b03-1" && ending == "" } [我愿意走得慢一点，不用把每段沉默填满。 # action:talk-b03-1 ]
    -> node_b03_1
+ { view_mode == "story" && beat == "b03-2" && ending == "" } [说件普通的小事吧，我也想认识日常里的你。 # action:talk-b03-2 ]
    -> node_b03_2
+ { view_mode == "story" && beat == "b03-3" && ending == "" } [我未必和你一样，但愿意把不同也说出来。 # action:talk-b03-3 ]
    -> node_b03_3
+ { view_mode == "story" && beat == "b03-4" && ending == "" } [临时改主意时，至少让另一个人知道。 # action:talk-b03-4 ]
    -> node_b03_4
+ { view_mode == "story" && beat == "b03-5" && ending == "" } [这样慢慢相处，比一直说漂亮话更让我放松。 # action:talk-b03-5 ]
    -> node_b03_5
+ { view_mode == "story" && beat == "b04-1" && ending == "" } [关于以后怎么相处，我也想听你的真实期待。 # action:talk-b04-1 ]
    -> node_b04_1
+ { view_mode == "story" && beat == "b04-2" && ending == "" } [我愿意分清楚，喜欢眼前和承诺以后是两件事。 # action:talk-b04-2 ]
    -> node_b04_2
+ { view_mode == "story" && beat == "b04-3" && ending == "" } [如果我一时没想清楚，也会直接告诉你。 # action:talk-b04-3 ]
    -> node_b04_3
+ { view_mode == "story" && beat == "b04-4" && ending == "" } [你也不用只问我，自己的那一份可以一起说。 # action:talk-b04-4 ]
    -> node_b04_4
+ { view_mode == "story" && beat == "b04-5" && ending == "" } [我们可以有不同期待，不用立刻把它变成争输赢。 # action:talk-b04-5 ]
    -> node_b04_5
+ { view_mode == "story" && beat == "b04-6" && ending == "" } [先把刚才的话放稳，再继续走一段。 # action:talk-b04-6 ]
    -> node_b04_6
+ { view_mode == "story" && beat == "b05-1" && ending == "" } [在这里安静站一会儿也好。 # action:talk-b05-1 ]
    -> node_b05_1
+ { view_mode == "story" && beat == "b05-2" && ending == "" } [你不用急着把每个想法都说成一个好答案。 # action:talk-b05-2 ]
    -> node_b05_2
+ { view_mode == "story" && beat == "b05-3" && ending == "" } [能听见真实的你，已经比机灵重要。 # action:talk-b05-3 ]
    -> node_b05_3
+ { view_mode == "story" && beat == "b05-4" && ending == "" } [我们可以继续聊，也可以先换一个轻松的话题。 # action:talk-b05-4 ]
    -> node_b05_4
+ { view_mode == "story" && beat == "b06-1" && ending == "" } [说一件相处时不太好意思承认的小习惯吧。 # action:talk-b06-1 ]
    -> node_b06_1
+ { view_mode == "story" && beat == "b06-2" && ending == "" } [我可以听，但不想一直靠猜来证明在意。 # action:talk-b06-2 ]
    -> node_b06_2
+ { view_mode == "story" && beat == "b06-3" && ending == "" } [有什么是你希望我们都能直接说清楚的？ # action:talk-b06-3 ]
    -> node_b06_3
+ { view_mode == "story" && beat == "b06-4" && ending == "" } [轻松的关系也需要双方都明白，不用猜另一种意思。 # action:talk-b06-4 ]
    -> node_b06_4
+ { view_mode == "story" && beat == "b06-5" && ending == "" } [如果以后想法变了，也给彼此重新表达的机会。 # action:talk-b06-5 ]
    -> node_b06_5
+ { view_mode == "story" && beat == "b06-6" && ending == "" } [我今天愿意来，也愿意听这些不那么漂亮的话。 # action:talk-b06-6 ]
    -> node_b06_6
+ { view_mode == "story" && beat == "b07-1" && ending == "" } [现在的靠近，可以慢慢来，也可以不发生。 # action:talk-b07-1 ]
    -> node_b07_1
+ { view_mode == "story" && beat == "b07-2" && ending == "" } [谢谢你肯直接问，也肯接住不同的答案。 # action:talk-b07-2 ]
    -> node_b07_2
+ { view_mode == "story" && beat == "b07-3" && ending == "" } [不管有没有接触，刚才认真说过的话都算数。 # action:talk-b07-3 ]
    -> node_b07_3
+ { view_mode == "story" && beat == "b07-4" && ending == "" } [那就按我们都舒服的方式，走到前面的路口。 # action:talk-b07-4 ]
    -> node_b07_4
+ { view_mode == "story" && beat == "b08-1" && ending == "" } [这次道别之前，我想把接下来怎样相处说清楚。 # action:talk-b08-1 ]
    -> node_b08_1
+ { view_mode == "story" && beat == "b08-2" && ending == "" } [我想听你的期待，也给自己的想法留一点诚实。 # action:talk-b08-2 ]
    -> node_b08_2
+ { view_mode == "story" && beat == "b08-3" && ending == "" } [无论答案是什么，都不把这两次相遇改写成错误。 # action:talk-b08-3 ]
    -> node_b08_3
+ { view_mode == "story" && beat == "b08-4" && ending == "" } [我已经愿意认真作出现在的选择。 # action:talk-b08-4 ]
    -> node_b08_4
+ { view_mode == "story" && beat == "b08-5" && ending == "" } [把答案留在我们都听得懂的地方。 # action:talk-b08-5 ]
    -> node_b08_5
+ { view_mode == "story" && beat == "a02-4" } [猜第一句 # action:talk-game-first ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-4" } [猜第二句 # action:talk-game-second ]
    -> node_a02_4
+ { view_mode == "story" && beat == "a02-3" } [不猜题也能继续认识 # action:talk-skip-game ]
    -> skip_game
+ { view_mode == "story" && beat == "a05-1" } [在附近等候 # action:talk-wait-gallery ]
    -> wait_gallery
+ { view_mode == "story" && beat == "a06-3" } [先普通相处 # action:talk-keep-friendly ]
    -> friendly_return
+ { view_mode == "story" && not second_date && ending == "" } [今晚先道别 # action:choose-farewell # explicit ]
    -> early_goodnight
+ { view_mode == "story" && trust && not appointment && (beat == "a-ending" || (ending != "" && not second_date)) } [再约一次见面 # action:choose-appointment # explicit ]
    -> make_appointment
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [一起散步再道别 # action:choose-depart # explicit ]
    -> ending_depart
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [今晚在这里告别 # action:choose-letter # explicit ]
    -> ending_letter
+ { view_mode == "story" && beat == "a-ending" && ending == "" } [在窗边再留片刻 # action:choose-stay # explicit ]
    -> ending_stay
+ { view_mode == "story" && beat == "a-ending" && chemistry && (not boundary_set || boundary_repaired) && ending == "" } [明确想一起度过今晚 # action:choose-night # explicit ]
    -> offer_night
+ { view_mode == "story" && beat == "night-confirm" && night_offer && (not boundary_set || boundary_repaired) } [双方再次说清楚 # action:choose-night-confirm # explicit ]
    -> spend_night
+ { view_mode == "story" && beat == "night-confirm" } [改成各自回家或散步 # action:choose-night-decline ]
    -> decline_night
+ { view_mode == "story" && appointment && ending != "" && not second_date } [进入另一次见面 # action:choose-reunion # explicit ]
    -> start_second_date
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [牵手 # action:choose-hand # explicit ]
    -> choose_hand
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [拥抱 # action:choose-hug # explicit ]
    -> choose_hug
+ { second_date && beat == "b07-2" && chemistry && (not boundary_set || boundary_repaired) } [短暂亲吻 # action:choose-kiss # explicit ]
    -> choose_kiss
+ { second_date && beat == "b-ending" && not date_finished } [closer # action:choose-date-close # explicit ]
    -> finish_closer
+ { second_date && beat == "b-ending" && not date_finished } [casual # action:choose-date-casual # explicit ]
    -> finish_casual
+ { second_date && not date_finished } [friends # action:choose-date-friends # explicit ]
    -> finish_friends
+ { second_date && beat == "b-ending" && not date_finished } [farewell # action:choose-date-farewell # explicit ]
    -> finish_farewell
+ { second_date && not date_finished } [今天需要先离开 # action:choose-date-pause # explicit ]
    -> date_pause
