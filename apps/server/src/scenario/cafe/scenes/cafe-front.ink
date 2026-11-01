=== enter_cafe_front ===
~ location = "cafe-front"
# cue:location:cafe-front
{ambience == "closed":营业牌已经翻面。门前，她回头看了看你。|门边贴着营业告示，门内还有暖光。要推门进去吗？}
-> menu

=== inspect_notice ===
~ notice_read = true
# cue:prop:notice
告示上写着：今晚是旧店最后一晚营业。
-> menu
