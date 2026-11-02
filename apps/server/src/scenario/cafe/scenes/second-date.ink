=== start_second_date ===
~ ambience = "closed"
# cue:ambience:closed
第一晚结束，故事来到另一个双方约好见面的晚上。
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
~ second_date = true
~ ending = ""
~ phase = 1
~ beat = "second-greeting"
# cue:location:cafe-front
你们如约在旧店门前见面。店已搬迁，雨棚下仍有避雨的位置。
~ rain_softened = false
# cue:environment:rain
雨水落在旧店门前，路灯映在湿路面上。
-> menu

=== choose_hand ===
~ handheld = true
~ contact_kind = "牵手"
# cue:beat:choose-hand
# voice:handConsent
她也明确愿意后，两只手轻轻相触。
-> menu

=== choose_hug ===
~ contact_kind = "拥抱"
# cue:beat:choose-hug
# voice:hugConsent
双方都愿意，才走近拥抱；随后各自留出舒服的距离。
-> menu

=== choose_kiss ===
~ contact_kind = "短暂亲吻"
# cue:beat:choose-kiss
# voice:kissConsent
她也明确愿意后，你们短暂地吻了一下。
-> menu

=== finish_closer ===
~ ending = "closer"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:closer
《还有下一次》：双方决定继续认真约会，其他约定留待以后一起商量。
-> menu

=== finish_casual ===
~ ending = "casual"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:casual
《轻松，也说清楚》：双方说清愿意轻松相处，没有许下排他或长期承诺。
-> menu

=== finish_friends ===
~ ending = "friends"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:friends
《好好认识过》：你说清希望做朋友，这次见面在普通相处的距离里收束。
-> menu

=== finish_farewell ===
~ ending = "farewell"
~ date_finished = true
~ phase = 3
~ beat = "finished"
# cue:ending:farewell
《到这里》：你们好好告别，今晚没有再约下一次。
-> menu

=== date_pause ===
~ date_finished = true
~ ending = "pause"
~ phase = 3
~ beat = "finished"
# cue:ending:pause
《先说晚安》：今晚先结束，尚未谈妥的事情没有被替双方作出决定。
-> menu
