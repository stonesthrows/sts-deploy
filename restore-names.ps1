# Restore Customer Name and App ID for all imported archive records
# Uses pdfUrl (fileId) to match Notion pages back to original manifest

$API = "https://sts-deploy.pages.dev/api/notion-pipeline"

# Original manifest: fileId -> name, stage, date
$manifest = @{
  "1exDegX5-h57anzLFkoXoDLlcUKvJkFz4" = @{name="Gretchen Gribble";       stage="cancelled"; cancelledAt="2024-01-01"}
  "13xLvaiKpJYpgSel9Ofsig-x-8Bimeu0C" = @{name="ESTHER OZCAN";           stage="cancelled"; cancelledAt="2024-01-01"}
  "1PTS7jbTnWMz-W-mfHyydk-lE6KnbtGRf" = @{name="Andy Ortiz";             stage="cancelled"; cancelledAt="2024-01-01"}
  "1MRU-hJZz1IZgRgOdq0ywYlc7UEWYYNbb" = @{name="Timothy Clements";       stage="delivered"; completedAt="2024-02-01"}
  "1ltUsCb2SXVtcuVuPRwnh7z5_qH2qI-26" = @{name="Paul Evans";             stage="delivered"; completedAt="2024-02-01"}
  "1a432Kh5gQynfa-S3ABvtR4Y9PKbhVgaa" = @{name="Chris Boyd";             stage="delivered"; completedAt="2024-02-01"}
  "1MivZsel_w2x5BiJTUEca8JYgvT7dd26l" = @{name="Bris Plaza";             stage="delivered"; completedAt="2024-02-01"}
  "1GlebypLNG-AOPayG8rue8IrScRdmUlp1" = @{name="Bris Plaza (1)";         stage="delivered"; completedAt="2024-02-01"}
  "1gM5G3RYfJJtcjdFOzS28MG85diBTgnLp" = @{name="Clare Mundy";            stage="cancelled"; cancelledAt="2024-03-01"}
  "198sd-mnX8JmIwH1QST_SAiWp4N0TNC2u" = @{name="Scott Baltisberger";     stage="delivered"; completedAt="2024-03-01"}
  "1jH7Z8GCs5WUSeSHwhiEGQ67QO3EQgSYn" = @{name="Sarah Vaisse";           stage="delivered"; completedAt="2024-03-01"}
  "1NWUTTMm-AvCz8kN-ipy3CNSOtN81lZEW" = @{name="Nishant Satpathy";       stage="delivered"; completedAt="2024-03-01"}
  "1_a2aHFYAoUw4n8_6fY9baEqa5sFu6jAu" = @{name="Kristina Lamm";          stage="delivered"; completedAt="2024-03-01"}
  "1ENDBaPg4N3agE-LvKFZHmADb9HpUkh3C" = @{name="Kelle Villareal";        stage="delivered"; completedAt="2024-03-01"}
  "1xu5D-CtH8A18zdUgG38xVjhlgsRv9gpe" = @{name="Kelby Fipps";            stage="delivered"; completedAt="2024-03-01"}
  "19VVaZMrk0rQQ1qZZtHjrAel2yASYmEhn" = @{name="Christian Montgomery";   stage="delivered"; completedAt="2024-03-01"}
  "1npTvJyogsCEvwMjWXhLPQgI6PDjMFXR6" = @{name="Chandler Jowell";        stage="delivered"; completedAt="2024-03-01"}
  "1v3gw2CbMvbpGFf6_12Iyy3MHNmJYiw04" = @{name="Allison-SFC";            stage="delivered"; completedAt="2024-03-01"}
  "1yxgt66owX2NnlmgGHU0BTXq_EXTNcft4" = @{name="Cynthia Harris";         stage="cancelled"; cancelledAt="2024-03-01"}
  "1GQKuRZa-Atxwyv_RaY0T9LW37tv6LBPo" = @{name="Bran Morgan";            stage="cancelled"; cancelledAt="2024-03-01"}
  "1HYm79JTz2cA-BVomRXWbA6HWgKYwkB02" = @{name="Sarina Sold";            stage="delivered"; completedAt="2024-04-01"}
  "1TcbnD20_ZzNO5wu6qhHir9N2lDIdFhTi" = @{name="Nina Seely earring conversion"; stage="delivered"; completedAt="2024-04-01"}
  "1cen42GrVObNKoS4Dk_VMQ-zWS2Ix5pni" = @{name="Nettie (instagram)";     stage="delivered"; completedAt="2024-04-01"}
  "1uk3BuRLVmRqtUvWyAzFz7GbSa0fdcmMv" = @{name="Mike Bienhoff";          stage="delivered"; completedAt="2024-04-01"}
  "1XpMJrcpVFUyFAURavaXQCwa2BEQTPiUv" = @{name="Lily Ralf's";            stage="delivered"; completedAt="2024-04-01"}
  "11KuTOGKJFBMvsrKVs6vRQRwbuz1gSlT7" = @{name="John Payne";             stage="delivered"; completedAt="2024-04-01"}
  "1-qx4sRauaIK05WTingw6zbgU3GZgMTJ1" = @{name="Jim Reist";              stage="delivered"; completedAt="2024-04-01"}
  "1K4X1O9rKk8uTnwn9z8dG1dMYt_fCkl_p" = @{name="Jane Files";             stage="delivered"; completedAt="2024-04-01"}
  "1K6m-DkdO8M99Z6a603lG3wJY5P1uxKDw" = @{name="Donna Wethrave";         stage="delivered"; completedAt="2024-04-01"}
  "17B4hf4MSysMqkK093aKT6ToP0agbJmhb" = @{name="David Chapman";          stage="delivered"; completedAt="2024-04-01"}
  "1nmhtijWvnCR8n0a2LfTLwZRwPQPGVasJ" = @{name="Daniel Goldberg";        stage="delivered"; completedAt="2024-04-01"}
  "1T_waXo5DlNzXBkYk9sPjArvvAsIsr8Jh" = @{name="Clare Simpson";          stage="delivered"; completedAt="2024-04-01"}
  "1_JUybCSRPtMosbDy6gp6km3TA6CXcmTe" = @{name="Chris (and Alia) Solarz"; stage="delivered"; completedAt="2024-04-01"}
  "15egc4YoBP4DoKTcIC5bd4BnP4-BcWsT0" = @{name="Bobbie Cardenas";        stage="delivered"; completedAt="2024-04-01"}
  "1j32bM__fBwXM20H3KvA-nhnOx_h5Qd7P" = @{name="Ann Kitchen";            stage="delivered"; completedAt="2024-04-01"}
  "1InGFR0V7yPx9KSTHXuMeiAR3K4DaBmdt" = @{name="Alexa";                  stage="delivered"; completedAt="2024-04-01"}
  "1cYJoxHchqrf5XjsxPPDjoz3j3lw99IcF" = @{name="Alex (- Lisa)";          stage="delivered"; completedAt="2024-04-01"}
  "18yIYzF7WySD1ABEbkX4opyCHv3dz5ip_" = @{name="Megan Forgey";           stage="cancelled"; cancelledAt="2024-04-01"}
  "1izWKFsZ_XRywxre6V_6Auhz9Dqhxibiu" = @{name="Devin Fry";              stage="delivered"; completedAt="2024-05-01"}
  "1yaoUIzNKjhBPE9fQhafZC0mHQ_13qHZO" = @{name="Paul Evans";             stage="cancelled"; cancelledAt="2024-05-01"}
  "1UGjZTiT6Uv82Qe77NNsFSRRUxF9P2ZDV" = @{name="Katie Thompson";         stage="delivered"; completedAt="2024-05-01"}
  "14a7kmpEt390r6h_o4vTiD5GW9DowIISB" = @{name="Elizabeth Todack";       stage="delivered"; completedAt="2024-05-01"}
  "1HE0CMLTm7IRKDSQZl_X4x4VXb6xsQ1UW" = @{name="Amaya Leon";             stage="delivered"; completedAt="2024-05-01"}
  "10FQypjjxUvU54QFDCEcAvB1QkYsmeJSh" = @{name="Rush Durkin";            stage="delivered"; completedAt="2024-06-01"}
  "1YLxXlVeBweN3rKe6RkUEsiSoyBSnVV9i" = @{name="Roman Gray";             stage="delivered"; completedAt="2024-06-01"}
  "1tGIWXdBIUY-o4BJTnE6QI-Q4L4KwKFnx" = @{name="Rama Pryne";             stage="delivered"; completedAt="2024-06-01"}
  "1kSjrBSruu3jLgIqm_RM8lcCoxrR-MMdd" = @{name="Pascal";                 stage="delivered"; completedAt="2024-06-01"}
  "1P73CzLNlNAHMC24zBG3hExSBBL1m3dQi" = @{name="Ky Martin";              stage="delivered"; completedAt="2024-06-01"}
  "191fbXCJAj9V9XNV1WgbpLHhrrLjWZMTB" = @{name="Julia Pasquarella";      stage="delivered"; completedAt="2024-06-01"}
  "1jQ1f4B1qxGz2yqQPTUH1AvUMMGZGguYu" = @{name="Derek";                  stage="delivered"; completedAt="2024-06-01"}
  "1-xwzURsV7PIAbLGaoPr7VgQrJU5XjAKn" = @{name="Bonnie Davis (Etsy Resize)"; stage="delivered"; completedAt="2024-06-01"}
  "1dLClROm-ninJsvSlaZixl5QdXC8K5Inp" = @{name="Adam Robinson";          stage="delivered"; completedAt="2024-06-01"}
  "1MkysIu8JN041KN0DFyDOm9PEBVJntK7u" = @{name="Adam Robinson (1)";      stage="delivered"; completedAt="2024-06-01"}
  "1ViWcaX0cIkJ173hhUKXPdksmp-sqyca0" = @{name="Leslie Novasel";         stage="cancelled"; cancelledAt="2024-06-01"}
  "1srWOfiWoZPxudb5gk7ZRfC22WqpcB87a" = @{name="Samid Hamv";             stage="delivered"; completedAt="2024-07-01"}
  "1j0flA6qxs0XDTPxgS7hRbdrw04XvW-Jl" = @{name="Salem Assaf";            stage="delivered"; completedAt="2024-07-01"}
  "1iF2wRH49vyUGiyFfqEui6TobGGHATYHB" = @{name="Henrik Strand";          stage="delivered"; completedAt="2024-07-01"}
  "1m1iJX8FN4vOlykavq5bzi7OQ1UERCflF" = @{name="Henrik Strand (1)";      stage="delivered"; completedAt="2024-07-01"}
  "1Uirs8PtcOgmbaLq4zPMWoj9MFyv8Hg_O" = @{name="Fatima Khan";            stage="delivered"; completedAt="2024-07-01"}
  "17B2IlcHOVhfe8q5Buf5jzsQFFNfcL163" = @{name="Fatima Khan (1)";        stage="delivered"; completedAt="2024-07-01"}
  "10kKNiOpOs9HpGPUTUIwqPIbcwpWsqeBr" = @{name="Erika (market)";         stage="delivered"; completedAt="2024-07-01"}
  "1wUBX5OEq1k07cy2iaXmPacTURdcTpBUY" = @{name="Brimm";                  stage="delivered"; completedAt="2024-07-01"}
  "1yvfcV5W_hB1HTrwJb81qmuiUD5OiDac8" = @{name="Adrian Abascal";         stage="delivered"; completedAt="2024-07-01"}
  "1buTdBaYQOHYTXJrFRaHJO7PFig5wtQiQ" = @{name="Travis Schultz";         stage="delivered"; completedAt="2024-08-01"}
  "1izv_Sbc2QJgmlU5KoSbkf0Pu7gNygkp1" = @{name="Samid Hamv";             stage="delivered"; completedAt="2024-08-01"}
  "10ySpd4GCbJI1avdzZMJFpRUmKZMiR961" = @{name="Maribel Rodriguez";      stage="delivered"; completedAt="2024-08-01"}
  "1-TurVmCfJLpZsO2rUI9fPR6YepsGR0u-" = @{name="Kevin Lawler";           stage="delivered"; completedAt="2024-08-01"}
  "1BNK4Ed7eOliMS-52xI9aIeQAJfhf7mjI" = @{name="Kate Malek";             stage="delivered"; completedAt="2024-08-01"}
  "1izhdiFRMYt1F8JJm76gC9IbyTVCTX5uP" = @{name="Cody Baird";             stage="cancelled"; cancelledAt="2024-08-01"}
  "1tZlTrBmEAE27nNPRMpxDgUCWt3kRBP46" = @{name="Johnathan Mares";        stage="cancelled"; cancelledAt="2024-09-01"}
  "1jKl7KiO2YBbdPZcwcrumjQruHkzMP14u" = @{name="John Woodsman Creations"; stage="cancelled"; cancelledAt="2024-09-01"}
  "1ldhwCOzLU_u5u-QErK9pFlanIFNIKvMH" = @{name="Erika";                  stage="cancelled"; cancelledAt="2024-09-01"}
  "1Jxoz01D0iRxdoseXyGNG25vNXsYpX2-m" = @{name="Dan Beauluix";           stage="cancelled"; cancelledAt="2024-09-01"}
  "1DTmPtUxsLh8sTVe6VQtqleZu7EYA95kx" = @{name="Megan Forgey";           stage="cancelled"; cancelledAt="2024-09-01"}
  "1CYvIj6bX4p6ovXkc0ZIlm_rKtnAfKsXz" = @{name="Andrea Amaya";           stage="cancelled"; cancelledAt="2024-09-01"}
  "1JfqRjD55QRody-LLIcef44dGktMAcsHx" = @{name="Stephanie (sourdough)";  stage="cancelled"; cancelledAt="2024-09-01"}
  "1_Q7YR_ZsRopdceDBvO-p1Dzl5igCSc0H" = @{name="kristen Togle";          stage="cancelled"; cancelledAt="2024-09-01"}
  "18l61zoZc4D-PoERHdRUmZVe85t0paQth" = @{name="Reno Solis";             stage="cancelled"; cancelledAt="2024-09-01"}
  "1Dku09GN0wyzk-eNsvjAS9j6zZPnIkCAF" = @{name="Laura Phillips";         stage="delivered"; completedAt="2024-10-01"}
  "1Xz_POttJSFCTRRcBurbQBMCFpy_af2V8" = @{name="Stephanie McKenna";      stage="cancelled"; cancelledAt="2024-10-01"}
  "1AoetB9GD2Xmzo4odLS3YOQvwBqTT2W5i" = @{name="Jane";                   stage="cancelled"; cancelledAt="2024-10-01"}
  "1ebUKustMv_n-2_uR36gYoV5DglYiE89v" = @{name="Ester Ozcan";            stage="cancelled"; cancelledAt="2024-10-01"}
  "1_R39brMSUK_PBfqeD00cYi9FBVI4R1uD" = @{name="Dan Beaulieu";           stage="cancelled"; cancelledAt="2024-10-01"}
  "1FoEMm3BYdmW6y_YdJctnkRADt33brdFG" = @{name="Brandon (Ambassador)";   stage="cancelled"; cancelledAt="2024-10-01"}
  "14T4pxyUcebS9C6-zx7fbgBsEu3iauwci" = @{name="Nicole Parish";          stage="delivered"; completedAt="2025-01-01"}
  "135Pjh-qrM-Ab8nBZ9nE7rOjD7qoFFiv_" = @{name="Juliana";                stage="delivered"; completedAt="2025-01-01"}
  "1nevqGS7pnmIHoo2f2KPpze9u7W3IrEUf" = @{name="Janice Hersey";          stage="delivered"; completedAt="2025-01-01"}
  "18XM63KxBLbYOaKV8LqImbP1SUtWplqGP" = @{name="Farrah";                 stage="delivered"; completedAt="2025-01-01"}
  "1MzI9qWqui1Hw0HpCdKT89lo30FAN1xT3" = @{name="Erika";                  stage="delivered"; completedAt="2025-01-01"}
  "1pB1wNrf8UitU8jLHn0zfnwwinvwrm2-9" = @{name="Emily Shedd";            stage="delivered"; completedAt="2025-01-01"}
  "1B58uadxw3py3BIH9i2Y7ULO13t2ei9dG" = @{name="Athena";                 stage="delivered"; completedAt="2025-01-01"}
  "1-rHr2BSuiRmL4V0RxesNJgVgz8VyFlt4" = @{name="Arleen";                 stage="delivered"; completedAt="2025-01-01"}
  "1N5zrHHu8v1abtNyNcqZpE-Ss0nEZQc5N" = @{name="Anna";                   stage="delivered"; completedAt="2025-01-01"}
  "1oXT80WHpCHOjkN3nX9RHFlXJAfuq_Feq" = @{name="Laura Eisenberg";        stage="delivered"; completedAt="2025-01-01"}
  "1tKKGP0mt7CaZePBsg8Mnsc0OkzaDaNNf" = @{name="Kathryn Smith";          stage="delivered"; completedAt="2025-01-01"}
  "1fIs_7E8nCNVHoeXhM5iOoi9GDe8lb_m2" = @{name="Jessie Lubke";           stage="delivered"; completedAt="2025-01-01"}
  "1UGIwbtTsTwqvLosPeU6zQdRDvHnMDzYb" = @{name="Cesar";                  stage="delivered"; completedAt="2025-01-01"}
  "1l3f5i7IVj4GRbRUE0--O4hBZh222WZ7m" = @{name="Lucas Ledsma";           stage="delivered"; completedAt="2025-02-01"}
  "18GJEYWaewMPKN0dcZBHDGTYdMNwTujZP" = @{name="Kathy Murphy";           stage="delivered"; completedAt="2025-02-01"}
  "1FdYV0bho8gy33odc_0BLkw1FwlJ8cSZm" = @{name="Jessie Lucked";          stage="delivered"; completedAt="2025-02-01"}
  "1OmjOfI5E7WQZQs_fJ9g5GOKsW4LMZtst" = @{name="Jacob Catano";           stage="delivered"; completedAt="2025-02-01"}
  "1A0GWzvzvfTh1HstNAKOljXLdtNzy6f_O" = @{name="Fernando";               stage="delivered"; completedAt="2025-02-01"}
  "18t1G14ghMR5yBqG8YEAN4tlb9W4g_JW3" = @{name="Ashlee Lamb";            stage="delivered"; completedAt="2025-02-01"}
  "1OIpPioumi0yjQxFv_ATkXYPbjj8FfYSr" = @{name="Ann Kitchen";            stage="delivered"; completedAt="2025-02-01"}
  "1vdcweRRHyHUUzyBPLsVLHfXSe17BeSJV" = @{name="Matthew Sperber";        stage="cancelled"; cancelledAt="2025-02-01"}
  "17Av4f0nuZfzx_VirQ9908ImWnkOdqTZY" = @{name="Macy (twist Ring)";      stage="cancelled"; cancelledAt="2025-02-01"}
  "1dClpwOlqS8ZKK_63ZSvEzvh2vzoY-Lko" = @{name="Pam Bolton";             stage="delivered"; completedAt="2025-03-01"}
  "1WF6CtRvcusw3EkCN34klj0yq7y_XedaE" = @{name="Karalee Prieto";         stage="delivered"; completedAt="2025-03-01"}
  "1Wv4A5iNc017xIx6cS7x1eBlbtBiTpQ65" = @{name="Cynthia Miller";         stage="cancelled"; cancelledAt="2025-03-01"}
  "1m0p4kC6Mm79CV241VFpCK71RaCc-82mC" = @{name="Sabrina Rush";           stage="delivered"; completedAt="2025-03-01"}
  "13UjFdrGXJraKev_TmLp1487HGCxEqm4A" = @{name="Vincent Chang";          stage="delivered"; completedAt="2025-04-01"}
  "1WcC0DM_9WTFyzVTr8N9Z1E6LX_kfVeDu" = @{name="Maggie Paul's";          stage="delivered"; completedAt="2025-04-01"}
  "1S0UF6Xk02BteiVaVAV6uxSr_MEuuabFY" = @{name="Lucy Anderson";          stage="delivered"; completedAt="2025-04-01"}
  "1HlVjIG8NJcPj4yzlBf6xAcjP5yipC3Eh" = @{name="Jesse Vondracek";        stage="delivered"; completedAt="2025-04-01"}
  "1wgUT84bKtSl6BvWCpd6K8FhFtHsD69I0" = @{name="Jesse Lubke2";           stage="delivered"; completedAt="2025-04-01"}
  "1e2FqUG1AheQD6HQtOfk61xE12Vr0sQ8a" = @{name="Jesse Lubke";            stage="delivered"; completedAt="2025-04-01"}
  "1lAdnYU2jl2NM323CUm9ZaUy5oojEu5Wp" = @{name="Elise Miner";            stage="delivered"; completedAt="2025-04-01"}
  "1vhQTgaWw58UjjtUoUrFqrsOlmIXVD6T5" = @{name="Ben Cardillo";           stage="delivered"; completedAt="2025-04-01"}
  "1cTqBKcFhymm321SyoIvsxnVCCFjSpw4R" = @{name="Audrey Davern";          stage="delivered"; completedAt="2025-04-01"}
  "1q_WJrpVKz2D6Hz9nvGQgn_O7rO6kJgz_" = @{name="Andrea Tyler";           stage="delivered"; completedAt="2025-04-01"}
  "1495uZWyghkhCI-9SCHCrkmu7--4KMl4y" = @{name="Jack Hogan";             stage="delivered"; completedAt="2025-05-01"}
  "1Ep_F0HTserFJLhtf0kSDFn7zBlPjvm8f" = @{name="Joanne Carol";           stage="delivered"; completedAt="2025-06-01"}
  "1EBxF-ScoRjyC4GqR_LD9cgBKgXmnZKDQ" = @{name="Angelique";              stage="delivered"; completedAt="2025-06-01"}
  "1o4BS8NDOxqLWM3aL1pwwB1Q7E54Edrt8" = @{name="Vika And Ben";           stage="delivered"; completedAt="2025-06-01"}
  "1QekCPZimhHE1WBjLCbdbf9GQ6ko_HAl7" = @{name="Terra Vickner";          stage="delivered"; completedAt="2025-06-01"}
  "15NBbQ2MjFQM3v5Z7RIwdTX5t18_QFUj1" = @{name="Robert Martinez";        stage="delivered"; completedAt="2025-06-01"}
  "1-HY3U4d4_1Q-COjGyipNMcrW4BQYwaiZ" = @{name="Loraine Kingsley";       stage="delivered"; completedAt="2025-06-01"}
  "1PhQmqioyuNiUruHHX_nJylR1aFFz4Dcc" = @{name="Francois Minoux";        stage="delivered"; completedAt="2025-06-01"}
  "1wtg0bBDk3SE-WH9J-6ULGGZmc4s5NXUr" = @{name="Darren Surovik";         stage="delivered"; completedAt="2025-06-01"}
  "1kNWI7oNaohleSl6q8ZyDuO4L7AvazC9J" = @{name="Conor Edmondson";        stage="delivered"; completedAt="2025-06-01"}
  "1_nw9vur98wl-RwR3OzV5dX2lEpZTZFYX" = @{name="Cesar And Ryan";         stage="delivered"; completedAt="2025-06-01"}
  "1zgHdbC6hyu0g02B_-L_Ov2pkKDNN6eTJ" = @{name="Ani Colt";               stage="delivered"; completedAt="2025-06-01"}
  "13EcGdQY-7LhULbnLtZ8rQ07VyI01C5nm" = @{name="Adrienne Hardy";         stage="delivered"; completedAt="2025-06-01"}
  "1pDHSGU3t4R04YfhuY5Ksnq7rWFEYKnr4" = @{name="Susan Love";             stage="cancelled"; cancelledAt="2025-06-01"}
  "18xYlQxCaJxhARamafDsJ4Cs88py_G5Yb" = @{name="Alexis Rodefor";         stage="cancelled"; cancelledAt="2025-06-01"}
  "1zCCCaMQaw7HjI0Ndxc52-3e59aWxAUF4" = @{name="Nick Middleton";         stage="delivered"; completedAt="2025-09-01"}
  "1OTDVXNK15upGAOPxbtv1f43XtQaHlnTT" = @{name="Linda";                  stage="delivered"; completedAt="2025-09-01"}
  "1IZULzpzc4ZLKCfg0lfGbPlsnH_7hwhMI" = @{name="Gareth Cornwall";        stage="delivered"; completedAt="2025-09-01"}
  "1DIURa1dHUk5_zbelJXNKmz0rIxNZ0bKe" = @{name="Ashley Davern";          stage="cancelled"; cancelledAt="2025-09-01"}
  "1XLICAjztPw8wO_rsKFsn37b-wOTNtGFD" = @{name="Shelby Nicole";          stage="delivered"; completedAt="2025-10-01"}
  "1Sozfwa9uIvvg6MzRDBF1Yb5kr_xq4YWk" = @{name="Sara Kopetman";          stage="delivered"; completedAt="2025-10-01"}
  "1bCg2HOhnntEKBnzJp05YRrWGo1af4QMh" = @{name="Sabrina Rusch";          stage="delivered"; completedAt="2025-10-01"}
  "1oOLJtY6yIV6j8trFcgWc_SovFKGkfQlo" = @{name="Nelly Carmack";          stage="delivered"; completedAt="2025-10-01"}
  "1hzhZgx_rw-0QcUQwQ6Z-V31jeupJZCiU" = @{name="Laura Eisenberg";        stage="delivered"; completedAt="2025-10-01"}
  "1xjbFje4LHrSn6MSDO1jNS8Jj917VqPLT" = @{name="Jac Clark";              stage="delivered"; completedAt="2025-10-01"}
  "10ICS8bUngCGK_pRoAjRiLDMncQgx8n2d" = @{name="Lisa Brown";             stage="delivered"; completedAt="2025-11-01"}
  "1l58laDebzSwGN8JA4cw9ZA4G-ZBVoyQE" = @{name="Lucy Anderson";          stage="delivered"; completedAt="2025-11-01"}
  "1Dg0j8z3Sy4xq-Mb0dqENWD9KjQugTQRh" = @{name="Sarah Jane Harris";      stage="delivered"; completedAt="2026-01-01"}
  "1u80B1RGIJrqC-2iKjSv5wA5T7YpeGBNO" = @{name="Melissa Lopez (DT Market)"; stage="delivered"; completedAt="2026-01-01"}
  "1jL914i928fXznPrMq_-iVqe8RGA-fPys" = @{name="Linda Jodry";            stage="delivered"; completedAt="2026-01-01"}
  "1Ib2POjNRtE-oXYE5yIH--IMft_euhcbN" = @{name="Jacob Long";             stage="delivered"; completedAt="2026-01-01"}
  "1NTgV9k1QlxO_MshNwqLfTR3Uz6Oy8jt_" = @{name="Ishaiah and Conor";      stage="delivered"; completedAt="2026-01-01"}
  "15oKBXPcGHdQNDc6J-BmlYc0zYspX8Rh8" = @{name="Audrey Davern";          stage="delivered"; completedAt="2026-01-01"}
  "1_5ibl_sP-J_7TK4rDKCkBFWOj0AuidM9" = @{name="Etsy Estimate";          stage="cancelled"; cancelledAt="2026-01-01"}
  "1c-snxyK0SziXt9l3hwO89zxl3dqjPcgc" = @{name="Nick Martello";          stage="delivered"; completedAt="2026-03-01"}
  "1yvvqn8AlF-preGRDtvYcgNJwA6WjIoJh" = @{name="Josh Goff";              stage="delivered"; completedAt="2026-03-01"}
  "1o1MrMlWcPu_cjBauORg4KIjGKAF3595x" = @{name="Corey";                  stage="delivered"; completedAt="2026-03-01"}
  "1z37ewGavmtTXchKXI8khMRJO1KlyRHRm" = @{name="Zephyr";                 stage="delivered"; completedAt="2026-04-01"}
  "1ofopEwKlEpsaUPMtkB9pSYka13vxixoo" = @{name="Joanne";                 stage="delivered"; completedAt="2026-04-01"}
  "1wP19DE6_Fv_DkcglUxq9bs-FskGwZiV1" = @{name="Jeanine Egby";           stage="delivered"; completedAt="2026-04-01"}
  "1tc6b1aQPmXrozlsfKGz6EMU70M2n0dFn" = @{name="Annaliese Walsten";      stage="delivered"; completedAt="2026-04-01"}
}

# Fetch current Notion records (they have notionId and pdfUrl but empty names)
Write-Host "Fetching orders from Notion..." -ForegroundColor Cyan
$orders = Invoke-RestMethod -Uri $API -Method Get
$toRestore = $orders | Where-Object { $_.pdfUrl -and $_.pdfUrl -like "*/file/d/*" }
Write-Host "Found $($toRestore.Count) archive records to restore." -ForegroundColor Yellow

$fixed = 0; $fail = 0; $skip = 0
foreach ($o in $toRestore) {
  # Extract fileId from URL: https://drive.google.com/file/d/{fileId}/view
  if ($o.pdfUrl -match '/file/d/([^/]+)/') {
    $fileId = $Matches[1]
  } else { $skip++; continue }

  $m = $manifest[$fileId]
  if (-not $m) { $skip++; Write-Host "  ? No manifest entry for fileId $fileId" -ForegroundColor DarkYellow; continue }

  $body = @{
    notionId = $o.notionId
    id       = $o.id
    name     = $m.name
    stage    = $m.stage
    pdfUrl   = $o.pdfUrl
  }
  if ($m.completedAt) { $body.completedAt = $m.completedAt }
  if ($m.cancelledAt) { $body.cancelledAt = $m.cancelledAt }

  try {
    Invoke-RestMethod -Uri $API -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress) -ErrorAction Stop | Out-Null
    $fixed++
    Write-Host "  ✓ [$fixed] $($m.name)" -ForegroundColor Green
  } catch {
    $fail++
    Write-Host "  ✗ FAILED $fileId : $_" -ForegroundColor Red
  }
  Start-Sleep -Milliseconds 350
}

Write-Host "`nDone. $fixed restored, $fail failed, $skip skipped." -ForegroundColor Cyan
