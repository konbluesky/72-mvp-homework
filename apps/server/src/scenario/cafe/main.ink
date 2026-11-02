VAR view_mode = "story"
VAR location = "street-wide"
VAR ambience = "open"
VAR ending = ""
VAR phase = 0
VAR beat = "arrival-street"
VAR shot_location = "street-wide"
VAR shot_mode = "shared"
VAR wait_nearby = false
VAR night_offer = false
VAR first_ending = ""
VAR contact_kind = ""
VAR met = false
VAR companionship = false
VAR chemistry = false
VAR boundary_set = false
VAR boundary_repaired = false
VAR appointment = false
VAR second_date = false
VAR date_finished = false
VAR handheld = false
VAR rain_softened = false
VAR notice_read = false
VAR wall_art_seen = false
VAR menu_read = false
VAR coffee_seen = false
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
INCLUDE scenes/progression.ink
INCLUDE endings.ink

=== story_start ===
-> menu

=== conversation_start ===
~ view_mode = "conversation"
~ location = "window-seat"
~ shot_location = "window-seat"
~ beat = "legacy"
~ phase = 1
~ met = true
-> menu

=== menu ===
+ {view_mode == "story" && shot_mode == "shared" && location != "street-wide"} [回到街角 # action:move-street-wide # explicit]
    -> enter_street_wide
+ {view_mode == "story" && shot_mode == "shared" && location != "cafe-front" && (met || ending == "")} [走到店门前 # action:move-cafe-front # explicit]
    -> enter_cafe_front
+ {view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location != "lobby" && (companionship || location == "cafe-front")} [推门进店 # action:move-lobby # explicit]
    -> enter_lobby
+ {view_mode == "story" && shot_mode == "shared" && companionship && not second_date && ending == "" && location != "window-seat"} [回窗边坐坐 # action:move-window-seat # explicit]
    -> enter_window_seat
+ {view_mode == "story" && shot_mode == "shared" && companionship && not second_date && ending == "" && location != "photo-corridor"} [一起看看走廊的风景画 # action:move-photo-corridor # explicit]
    -> enter_photo_corridor
+ {view_mode == "story" && shot_mode == "shared" && companionship && not second_date && ending == "" && location != "counter"} [去吧台看看 # action:move-counter # explicit]
    -> enter_counter
+ {view_mode == "story" && shot_mode == "shared" && second_date && location != "street-walk" && not date_finished} [沿街走走 # action:move-street-walk # explicit]
    -> enter_street_walk
+ {view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && (location == "lobby" || location == "cafe-front")} [看营业提示 # action:inspect-notice]
    -> inspect_notice
+ {view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "photo-corridor"} [看墙上的风景画 # action:inspect-wall-art]
    -> inspect_wall_art
+ {view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "counter"} [看吧台饮品单 # action:inspect-menu # explicit]
    -> inspect_menu
+ {view_mode == "story" && shot_mode == "shared" && not second_date && ending == "" && location == "window-seat" && met} [看桌上的咖啡 # action:inspect-coffee]
    -> inspect_coffee
+ {view_mode == "conversation" && ending == ""} [问问她是否在等人 # action:talk-waiting # explicit]
    -> hear_waiting
+ {view_mode == "conversation" && ending == "" && not companionship} [愿意坐下聊聊 # action:talk-companionship # explicit]
    -> offer_companionship
+ {view_mode == "story" && beat == "first-greeting" && location == "lobby" && ending == ""} [接受拼桌，到窗边坐下 # action:talk-sit # explicit]
    -> sit_together
+ {companionship && shot_mode == "shared" && ending == "" && not chemistry && (not boundary_set || boundary_repaired)} [表达想进一步认识她 # action:talk-spark # explicit]
    -> talk_spark
+ {met && shot_mode == "shared" && ending == "" && (not boundary_set || boundary_repaired)} [先保持普通相处 # action:talk-boundary # explicit]
    -> talk_boundary
+ {met && boundary_set && not boundary_repaired && ending == "" && shot_mode == "shared"} [重新表达愿意试着约会 # action:talk-reopen # explicit]
    -> talk_reopen
+ {companionship && not second_date && shot_mode == "shared" && ending == "" && not game_played && (location == "window-seat" || location == "photo-corridor")} [一起玩个轻松的猜谜 # action:talk-game # explicit]
    -> play_game
+ {game_played && not game_answered && shot_mode == "shared" && ending == ""} [猜第一句 # action:talk-game-first # explicit]
    -> game_first
+ {game_played && not game_answered && shot_mode == "shared" && ending == ""} [猜第二句 # action:talk-game-second # explicit]
    -> game_second
+ {game_played && not game_answered && shot_mode == "shared" && ending == ""} [猜第三句 # action:talk-game-third # explicit]
    -> game_third
+ {companionship && not second_date && shot_mode == "shared" && ending == "" && not makeup_returned && (location == "window-seat" || location == "photo-corridor")} [留在窗边，等她整理一下 # action:talk-wait-seat # explicit]
    -> wait_at_seat
+ {companionship && not second_date && shot_mode == "shared" && ending == "" && not makeup_returned && (location == "window-seat" || location == "photo-corridor")} [在走廊等她整理一下 # action:talk-wait-gallery # explicit]
    -> wait_at_gallery
+ {view_mode == "story" && not second_date && ending == ""} [今晚先离开 # action:choose-farewell # explicit]
    -> early_goodnight
+ {view_mode == "story" && met && companionship && not appointment && not second_date && (beat == "first-choice" || ending != "")} [提出再约一次见面 # action:choose-appointment # explicit]
    -> make_appointment
+ {view_mode == "story" && beat == "first-choice" && ending == ""} [一起散步再道别 # action:choose-depart # explicit]
    -> ending_depart
+ {view_mode == "story" && beat == "first-choice" && ending == ""} [今晚在这里告别 # action:choose-letter # explicit]
    -> ending_letter
+ {view_mode == "story" && beat == "first-choice" && ending == ""} [回窗边再坐片刻 # action:choose-stay # explicit]
    -> ending_stay
+ {view_mode == "story" && beat == "first-choice" && chemistry && (not boundary_set || boundary_repaired) && ending == ""} [提出今晚继续一起相处 # action:choose-night # explicit]
    -> offer_night
+ {view_mode == "story" && beat == "night-confirm" && night_offer && (not boundary_set || boundary_repaired)} [确认双方愿意共度这一夜 # action:choose-night-confirm # explicit]
    -> spend_night
+ {view_mode == "story" && beat == "night-confirm"} [改成各自回家或散步 # action:choose-night-decline # explicit]
    -> decline_night
+ {view_mode == "story" && appointment && ending != "" && not second_date} [进入另一次约好的见面 # action:choose-reunion # explicit]
    -> start_second_date
+ {second_date && not date_finished && shot_mode == "shared" && chemistry && (not boundary_set || boundary_repaired)} [问她是否愿意牵手 # action:choose-hand # explicit]
    -> choose_hand
+ {second_date && not date_finished && shot_mode == "shared" && chemistry && (not boundary_set || boundary_repaired)} [问她是否愿意拥抱 # action:choose-hug # explicit]
    -> choose_hug
+ {second_date && not date_finished && shot_mode == "shared" && chemistry && (not boundary_set || boundary_repaired)} [问她是否愿意短暂亲吻 # action:choose-kiss # explicit]
    -> choose_kiss
+ {second_date && beat == "second-choice" && not date_finished && (not boundary_set || boundary_repaired)} [提出继续认真约会 # action:choose-date-close # explicit]
    -> finish_closer
+ {second_date && beat == "second-choice" && not date_finished && chemistry && (not boundary_set || boundary_repaired)} [提出轻松相处，并说清期待 # action:choose-date-casual # explicit]
    -> finish_casual
+ {second_date && not date_finished} [保持朋友关系 # action:choose-date-friends # explicit]
    -> finish_friends
+ {second_date && beat == "second-choice" && not date_finished} [好好告别，不再继续约会 # action:choose-date-farewell # explicit]
    -> finish_farewell
+ {second_date && not date_finished} [今天先道晚安 # action:choose-date-pause # explicit]
    -> date_pause
