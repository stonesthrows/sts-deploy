# Import historical work orders as archived cards into Notion
# Endpoint: https://sts-deploy.pages.dev/api/notion-pipeline

$API = "https://sts-deploy.pages.dev/api/notion-pipeline"

function viewUrl($fileId) { "https://drive.google.com/file/d/$fileId/view?usp=drivesdk" }
function makeId { "u_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + "_" + (Get-Random -Maximum 9999) }

$orders = @(
  # ── 2024 ROOT  (cancelled, 2024-01-01) ──────────────────────────────────────
  @{name="Gretchen Gribble";       stage="cancelled"; cancelledAt="2024-01-01"; fileId="1exDegX5-h57anzLFkoXoDLlcUKvJkFz4"}
  @{name="ESTHER OZCAN";           stage="cancelled"; cancelledAt="2024-01-01"; fileId="13xLvaiKpJYpgSel9Ofsig-x-8Bimeu0C"}
  @{name="Andy Ortiz";             stage="cancelled"; cancelledAt="2024-01-01"; fileId="1PTS7jbTnWMz-W-mfHyydk-lE6KnbtGRf"}

  # ── Feb 2024 Completed  (delivered, 2024-02-01) ──────────────────────────────
  @{name="Timothy Clements";       stage="delivered"; completedAt="2024-02-01"; fileId="1MRU-hJZz1IZgRgOdq0ywYlc7UEWYYNbb"}
  @{name="Paul Evans";             stage="delivered"; completedAt="2024-02-01"; fileId="1ltUsCb2SXVtcuVuPRwnh7z5_qH2qI-26"}
  @{name="Chris Boyd";             stage="delivered"; completedAt="2024-02-01"; fileId="1a432Kh5gQynfa-S3ABvtR4Y9PKbhVgaa"}
  @{name="Bris Plaza";             stage="delivered"; completedAt="2024-02-01"; fileId="1MivZsel_w2x5BiJTUEca8JYgvT7dd26l"}
  @{name="Bris Plaza (1)";         stage="delivered"; completedAt="2024-02-01"; fileId="1GlebypLNG-AOPayG8rue8IrScRdmUlp1"}

  # ── Mar 2024 direct  (cancelled, 2024-03-01) ─────────────────────────────────
  @{name="Clare Mundy";            stage="cancelled"; cancelledAt="2024-03-01"; fileId="1gM5G3RYfJJtcjdFOzS28MG85diBTgnLp"}

  # ── Mar 2024 Completed  (delivered, 2024-03-01) ──────────────────────────────
  @{name="Scott Baltisberger";     stage="delivered"; completedAt="2024-03-01"; fileId="198sd-mnX8JmIwH1QST_SAiWp4N0TNC2u"}
  @{name="Sarah Vaisse";           stage="delivered"; completedAt="2024-03-01"; fileId="1jH7Z8GCs5WUSeSHwhiEGQ67QO3EQgSYn"}
  @{name="Nishant Satpathy";       stage="delivered"; completedAt="2024-03-01"; fileId="1NWUTTMm-AvCz8kN-ipy3CNSOtN81lZEW"}
  @{name="Kristina Lamm";          stage="delivered"; completedAt="2024-03-01"; fileId="1_a2aHFYAoUw4n8_6fY9baEqa5sFu6jAu"}
  @{name="Kelle Villareal";        stage="delivered"; completedAt="2024-03-01"; fileId="1ENDBaPg4N3agE-LvKFZHmADb9HpUkh3C"}
  @{name="Kelby Fipps";            stage="delivered"; completedAt="2024-03-01"; fileId="1xu5D-CtH8A18zdUgG38xVjhlgsRv9gpe"}
  @{name="Christian Montgomery";   stage="delivered"; completedAt="2024-03-01"; fileId="19VVaZMrk0rQQ1qZZtHjrAel2yASYmEhn"}
  @{name="Chandler Jowell";        stage="delivered"; completedAt="2024-03-01"; fileId="1npTvJyogsCEvwMjWXhLPQgI6PDjMFXR6"}
  @{name="Allison-SFC";            stage="delivered"; completedAt="2024-03-01"; fileId="1v3gw2CbMvbpGFf6_12Iyy3MHNmJYiw04"}

  # ── Mar 2024 Canceled  (cancelled, 2024-03-01) ───────────────────────────────
  @{name="Cynthia Harris";         stage="cancelled"; cancelledAt="2024-03-01"; fileId="1yxgt66owX2NnlmgGHU0BTXq_EXTNcft4"}
  @{name="Bran Morgan";            stage="cancelled"; cancelledAt="2024-03-01"; fileId="1GQKuRZa-Atxwyv_RaY0T9LW37tv6LBPo"}

  # ── Apr 2024 Completed  (delivered, 2024-04-01) ──────────────────────────────
  @{name="Sarina Sold";            stage="delivered"; completedAt="2024-04-01"; fileId="1HYm79JTz2cA-BVomRXWbA6HWgKYwkB02"}
  @{name="Nina Seely earring conversion"; stage="delivered"; completedAt="2024-04-01"; fileId="1TcbnD20_ZzNO5wu6qhHir9N2lDIdFhTi"}
  @{name="Nettie (instagram)";     stage="delivered"; completedAt="2024-04-01"; fileId="1cen42GrVObNKoS4Dk_VMQ-zWS2Ix5pni"}
  @{name="Mike Bienhoff";          stage="delivered"; completedAt="2024-04-01"; fileId="1uk3BuRLVmRqtUvWyAzFz7GbSa0fdcmMv"}
  @{name="Lily Ralf's";            stage="delivered"; completedAt="2024-04-01"; fileId="1XpMJrcpVFUyFAURavaXQCwa2BEQTPiUv"}
  @{name="John Payne";             stage="delivered"; completedAt="2024-04-01"; fileId="11KuTOGKJFBMvsrKVs6vRQRwbuz1gSlT7"}
  @{name="Jim Reist";              stage="delivered"; completedAt="2024-04-01"; fileId="1-qx4sRauaIK05WTingw6zbgU3GZgMTJ1"}
  @{name="Jane Files";             stage="delivered"; completedAt="2024-04-01"; fileId="1K4X1O9rKk8uTnwn9z8dG1dMYt_fCkl_p"}
  @{name="Donna Wethrave";         stage="delivered"; completedAt="2024-04-01"; fileId="1K6m-DkdO8M99Z6a603lG3wJY5P1uxKDw"}
  @{name="David Chapman";          stage="delivered"; completedAt="2024-04-01"; fileId="17B4hf4MSysMqkK093aKT6ToP0agbJmhb"}
  @{name="Daniel Goldberg";        stage="delivered"; completedAt="2024-04-01"; fileId="1nmhtijWvnCR8n0a2LfTLwZRwPQPGVasJ"}
  @{name="Clare Simpson";          stage="delivered"; completedAt="2024-04-01"; fileId="1T_waXo5DlNzXBkYk9sPjArvvAsIsr8Jh"}
  @{name="Chris (and Alia) Solarz"; stage="delivered"; completedAt="2024-04-01"; fileId="1_JUybCSRPtMosbDy6gp6km3TA6CXcmTe"}
  @{name="Bobbie Cardenas";        stage="delivered"; completedAt="2024-04-01"; fileId="15egc4YoBP4DoKTcIC5bd4BnP4-BcWsT0"}
  @{name="Ann Kitchen";            stage="delivered"; completedAt="2024-04-01"; fileId="1j32bM__fBwXM20H3KvA-nhnOx_h5Qd7P"}
  @{name="Alexa";                  stage="delivered"; completedAt="2024-04-01"; fileId="1InGFR0V7yPx9KSTHXuMeiAR3K4DaBmdt"}
  @{name="Alex (- Lisa)";          stage="delivered"; completedAt="2024-04-01"; fileId="1cYJoxHchqrf5XjsxPPDjoz3j3lw99IcF"}

  # ── Apr 2024 Cancelled  (cancelled, 2024-04-01) ──────────────────────────────
  @{name="Megan Forgey";           stage="cancelled"; cancelledAt="2024-04-01"; fileId="18yIYzF7WySD1ABEbkX4opyCHv3dz5ip_"}

  # ── May 2024 Completed  (delivered, 2024-05-01) ──────────────────────────────
  @{name="Devin Fry";              stage="delivered"; completedAt="2024-05-01"; fileId="1izWKFsZ_XRywxre6V_6Auhz9Dqhxibiu"}

  # ── May 2024 direct  (check content; Paul Evans=cancelled, rest=delivered) ───
  @{name="Paul Evans";             stage="cancelled"; cancelledAt="2024-05-01"; fileId="1yaoUIzNKjhBPE9fQhafZC0mHQ_13qHZO"}
  @{name="Katie Thompson";         stage="delivered"; completedAt="2024-05-01"; fileId="1UGjZTiT6Uv82Qe77NNsFSRRUxF9P2ZDV"}
  @{name="Elizabeth Todack";       stage="delivered"; completedAt="2024-05-01"; fileId="14a7kmpEt390r6h_o4vTiD5GW9DowIISB"}
  @{name="Amaya Leon";             stage="delivered"; completedAt="2024-05-01"; fileId="1HE0CMLTm7IRKDSQZl_X4x4VXb6xsQ1UW"}

  # ── Jun 2024 Completed  (delivered, 2024-06-01) ──────────────────────────────
  @{name="Rush Durkin";            stage="delivered"; completedAt="2024-06-01"; fileId="10FQypjjxUvU54QFDCEcAvB1QkYsmeJSh"}
  @{name="Roman Gray";             stage="delivered"; completedAt="2024-06-01"; fileId="1YLxXlVeBweN3rKe6RkUEsiSoyBSnVV9i"}
  @{name="Rama Pryne";             stage="delivered"; completedAt="2024-06-01"; fileId="1tGIWXdBIUY-o4BJTnE6QI-Q4L4KwKFnx"}
  @{name="Pascal";                 stage="delivered"; completedAt="2024-06-01"; fileId="1kSjrBSruu3jLgIqm_RM8lcCoxrR-MMdd"}
  @{name="Ky Martin";              stage="delivered"; completedAt="2024-06-01"; fileId="1P73CzLNlNAHMC24zBG3hExSBBL1m3dQi"}
  @{name="Julia Pasquarella";      stage="delivered"; completedAt="2024-06-01"; fileId="191fbXCJAj9V9XNV1WgbpLHhrrLjWZMTB"}
  @{name="Derek";                  stage="delivered"; completedAt="2024-06-01"; fileId="1jQ1f4B1qxGz2yqQPTUH1AvUMMGZGguYu"}
  @{name="Bonnie Davis (Etsy Resize)"; stage="delivered"; completedAt="2024-06-01"; fileId="1-xwzURsV7PIAbLGaoPr7VgQrJU5XjAKn"}
  @{name="Adam Robinson";          stage="delivered"; completedAt="2024-06-01"; fileId="1dLClROm-ninJsvSlaZixl5QdXC8K5Inp"}
  @{name="Adam Robinson (1)";      stage="delivered"; completedAt="2024-06-01"; fileId="1MkysIu8JN041KN0DFyDOm9PEBVJntK7u"}

  # ── Jun 2024 Cancelled Orders  (cancelled, 2024-06-01) ───────────────────────
  @{name="Leslie Novasel";         stage="cancelled"; cancelledAt="2024-06-01"; fileId="1ViWcaX0cIkJ173hhUKXPdksmp-sqyca0"}

  # ── Jul 2024 Completed  (delivered, 2024-07-01) ──────────────────────────────
  @{name="Samid Hamv";             stage="delivered"; completedAt="2024-07-01"; fileId="1srWOfiWoZPxudb5gk7ZRfC22WqpcB87a"}
  @{name="Salem Assaf";            stage="delivered"; completedAt="2024-07-01"; fileId="1j0flA6qxs0XDTPxgS7hRbdrw04XvW-Jl"}
  @{name="Henrik Strand";          stage="delivered"; completedAt="2024-07-01"; fileId="1iF2wRH49vyUGiyFfqEui6TobGGHATYHB"}
  @{name="Henrik Strand (1)";      stage="delivered"; completedAt="2024-07-01"; fileId="1m1iJX8FN4vOlykavq5bzi7OQ1UERCflF"}
  @{name="Fatima Khan";            stage="delivered"; completedAt="2024-07-01"; fileId="1Uirs8PtcOgmbaLq4zPMWoj9MFyv8Hg_O"}
  @{name="Fatima Khan (1)";        stage="delivered"; completedAt="2024-07-01"; fileId="17B2IlcHOVhfe8q5Buf5jzsQFFNfcL163"}
  @{name="Erika (market)";         stage="delivered"; completedAt="2024-07-01"; fileId="10kKNiOpOs9HpGPUTUIwqPIbcwpWsqeBr"}
  @{name="Brimm";                  stage="delivered"; completedAt="2024-07-01"; fileId="1wUBX5OEq1k07cy2iaXmPacTURdcTpBUY"}
  @{name="Adrian Abascal";         stage="delivered"; completedAt="2024-07-01"; fileId="1yvfcV5W_hB1HTrwJb81qmuiUD5OiDac8"}

  # ── Aug 2024 Completed  (delivered, 2024-08-01) ──────────────────────────────
  @{name="Travis Schultz";         stage="delivered"; completedAt="2024-08-01"; fileId="1buTdBaYQOHYTXJrFRaHJO7PFig5wtQiQ"}
  @{name="Samid Hamv";             stage="delivered"; completedAt="2024-08-01"; fileId="1izv_Sbc2QJgmlU5KoSbkf0Pu7gNygkp1"}
  @{name="Maribel Rodriguez";      stage="delivered"; completedAt="2024-08-01"; fileId="10ySpd4GCbJI1avdzZMJFpRUmKZMiR961"}
  @{name="Kevin Lawler";           stage="delivered"; completedAt="2024-08-01"; fileId="1-TurVmCfJLpZsO2rUI9fPR6YepsGR0u-"}
  @{name="Kate Malek";             stage="delivered"; completedAt="2024-08-01"; fileId="1BNK4Ed7eOliMS-52xI9aIeQAJfhf7mjI"}

  # ── Aug 2024 Cancelled  (cancelled, 2024-08-01) ──────────────────────────────
  @{name="Cody Baird";             stage="cancelled"; cancelledAt="2024-08-01"; fileId="1izhdiFRMYt1F8JJm76gC9IbyTVCTX5uP"}

  # ── Sep 2024 direct + subfolders  (cancelled, 2024-09-01) ────────────────────
  @{name="Johnathan Mares";        stage="cancelled"; cancelledAt="2024-09-01"; fileId="1tZlTrBmEAE27nNPRMpxDgUCWt3kRBP46"}
  @{name="John Woodsman Creations"; stage="cancelled"; cancelledAt="2024-09-01"; fileId="1jKl7KiO2YBbdPZcwcrumjQruHkzMP14u"}
  @{name="Erika";                  stage="cancelled"; cancelledAt="2024-09-01"; fileId="1ldhwCOzLU_u5u-QErK9pFlanIFNIKvMH"}
  @{name="Dan Beauluix";           stage="cancelled"; cancelledAt="2024-09-01"; fileId="1Jxoz01D0iRxdoseXyGNG25vNXsYpX2-m"}
  @{name="Megan Forgey";           stage="cancelled"; cancelledAt="2024-09-01"; fileId="1DTmPtUxsLh8sTVe6VQtqleZu7EYA95kx"}
  @{name="Andrea Amaya";           stage="cancelled"; cancelledAt="2024-09-01"; fileId="1CYvIj6bX4p6ovXkc0ZIlm_rKtnAfKsXz"}
  @{name="Stephanie (sourdough)";  stage="cancelled"; cancelledAt="2024-09-01"; fileId="1JfqRjD55QRody-LLIcef44dGktMAcsHx"}
  @{name="kristen Togle";          stage="cancelled"; cancelledAt="2024-09-01"; fileId="1_Q7YR_ZsRopdceDBvO-p1Dzl5igCSc0H"}
  @{name="Reno Solis";             stage="cancelled"; cancelledAt="2024-09-01"; fileId="18l61zoZc4D-PoERHdRUmZVe85t0paQth"}

  # ── Oct 2024 Completed  (delivered, 2024-10-01) ──────────────────────────────
  @{name="Laura Phillips";         stage="delivered"; completedAt="2024-10-01"; fileId="1Dku09GN0wyzk-eNsvjAS9j6zZPnIkCAF"}

  # ── Oct 2024 direct  (cancelled, 2024-10-01) ─────────────────────────────────
  @{name="Stephanie McKenna";      stage="cancelled"; cancelledAt="2024-10-01"; fileId="1Xz_POttJSFCTRRcBurbQBMCFpy_af2V8"}
  @{name="Jane";                   stage="cancelled"; cancelledAt="2024-10-01"; fileId="1AoetB9GD2Xmzo4odLS3YOQvwBqTT2W5i"}
  @{name="Ester Ozcan";            stage="cancelled"; cancelledAt="2024-10-01"; fileId="1ebUKustMv_n-2_uR36gYoV5DglYiE89v"}
  @{name="Dan Beaulieu";           stage="cancelled"; cancelledAt="2024-10-01"; fileId="1_R39brMSUK_PBfqeD00cYi9FBVI4R1uD"}
  @{name="Brandon (Ambassador)";   stage="cancelled"; cancelledAt="2024-10-01"; fileId="1FoEMm3BYdmW6y_YdJctnkRADt33brdFG"}

  # ── Jan 2025 Picked Up-Shipped  (delivered, 2025-01-01) ──────────────────────
  @{name="Nicole Parish";          stage="delivered"; completedAt="2025-01-01"; fileId="14T4pxyUcebS9C6-zx7fbgBsEu3iauwci"}
  @{name="Juliana";                stage="delivered"; completedAt="2025-01-01"; fileId="135Pjh-qrM-Ab8nBZ9nE7rOjD7qoFFiv_"}
  @{name="Janice Hersey";          stage="delivered"; completedAt="2025-01-01"; fileId="1nevqGS7pnmIHoo2f2KPpze9u7W3IrEUf"}
  @{name="Farrah";                 stage="delivered"; completedAt="2025-01-01"; fileId="18XM63KxBLbYOaKV8LqImbP1SUtWplqGP"}
  @{name="Erika";                  stage="delivered"; completedAt="2025-01-01"; fileId="1MzI9qWqui1Hw0HpCdKT89lo30FAN1xT3"}
  @{name="Emily Shedd";            stage="delivered"; completedAt="2025-01-01"; fileId="1pB1wNrf8UitU8jLHn0zfnwwinvwrm2-9"}
  @{name="Athena";                 stage="delivered"; completedAt="2025-01-01"; fileId="1B58uadxw3py3BIH9i2Y7ULO13t2ei9dG"}
  @{name="Arleen";                 stage="delivered"; completedAt="2025-01-01"; fileId="1-rHr2BSuiRmL4V0RxesNJgVgz8VyFlt4"}
  @{name="Anna";                   stage="delivered"; completedAt="2025-01-01"; fileId="1N5zrHHu8v1abtNyNcqZpE-Ss0nEZQc5N"}

  # ── Jan 2025 Custom  (delivered, 2025-01-01) ─────────────────────────────────
  @{name="Laura Eisenberg";        stage="delivered"; completedAt="2025-01-01"; fileId="1oXT80WHpCHOjkN3nX9RHFlXJAfuq_Feq"}
  @{name="Kathryn Smith";          stage="delivered"; completedAt="2025-01-01"; fileId="1tKKGP0mt7CaZePBsg8Mnsc0OkzaDaNNf"}
  @{name="Jessie Lubke";           stage="delivered"; completedAt="2025-01-01"; fileId="1fIs_7E8nCNVHoeXhM5iOoi9GDe8lb_m2"}
  @{name="Cesar";                  stage="delivered"; completedAt="2025-01-01"; fileId="1UGIwbtTsTwqvLosPeU6zQdRDvHnMDzYb"}

  # ── Feb 2025 Completed  (delivered, 2025-02-01) ──────────────────────────────
  @{name="Lucas Ledsma";           stage="delivered"; completedAt="2025-02-01"; fileId="1l3f5i7IVj4GRbRUE0--O4hBZh222WZ7m"}
  @{name="Kathy Murphy";           stage="delivered"; completedAt="2025-02-01"; fileId="18GJEYWaewMPKN0dcZBHDGTYdMNwTujZP"}
  @{name="Jessie Lucked";          stage="delivered"; completedAt="2025-02-01"; fileId="1FdYV0bho8gy33odc_0BLkw1FwlJ8cSZm"}
  @{name="Jacob Catano";           stage="delivered"; completedAt="2025-02-01"; fileId="1OmjOfI5E7WQZQs_fJ9g5GOKsW4LMZtst"}
  @{name="Fernando";               stage="delivered"; completedAt="2025-02-01"; fileId="1A0GWzvzvfTh1HstNAKOljXLdtNzy6f_O"}
  @{name="Ashlee Lamb";            stage="delivered"; completedAt="2025-02-01"; fileId="18t1G14ghMR5yBqG8YEAN4tlb9W4g_JW3"}
  @{name="Ann Kitchen";            stage="delivered"; completedAt="2025-02-01"; fileId="1OIpPioumi0yjQxFv_ATkXYPbjj8FfYSr"}

  # ── Feb 2025 Inactive  (cancelled, 2025-02-01) ───────────────────────────────
  @{name="Matthew Sperber";        stage="cancelled"; cancelledAt="2025-02-01"; fileId="1vdcweRRHyHUUzyBPLsVLHfXSe17BeSJV"}
  @{name="Macy (twist Ring)";      stage="cancelled"; cancelledAt="2025-02-01"; fileId="17Av4f0nuZfzx_VirQ9908ImWnkOdqTZY"}

  # ── Mar 2025 Completed  (delivered, 2025-03-01) ──────────────────────────────
  @{name="Pam Bolton";             stage="delivered"; completedAt="2025-03-01"; fileId="1dClpwOlqS8ZKK_63ZSvEzvh2vzoY-Lko"}
  @{name="Karalee Prieto";         stage="delivered"; completedAt="2025-03-01"; fileId="1WF6CtRvcusw3EkCN34klj0yq7y_XedaE"}

  # ── Mar 2025 Cancelled  (cancelled, 2025-03-01) ──────────────────────────────
  @{name="Cynthia Miller";         stage="cancelled"; cancelledAt="2025-03-01"; fileId="1Wv4A5iNc017xIx6cS7x1eBlbtBiTpQ65"}

  # ── Mar 2025 direct  (delivered, 2025-03-01) ─────────────────────────────────
  @{name="Sabrina Rush";           stage="delivered"; completedAt="2025-03-01"; fileId="1m0p4kC6Mm79CV241VFpCK71RaCc-82mC"}

  # ── Apr 2025 Completed  (delivered, 2025-04-01) ──────────────────────────────
  @{name="Vincent Chang";          stage="delivered"; completedAt="2025-04-01"; fileId="13UjFdrGXJraKev_TmLp1487HGCxEqm4A"}
  @{name="Maggie Paul's";          stage="delivered"; completedAt="2025-04-01"; fileId="1WcC0DM_9WTFyzVTr8N9Z1E6LX_kfVeDu"}
  @{name="Lucy Anderson";          stage="delivered"; completedAt="2025-04-01"; fileId="1S0UF6Xk02BteiVaVAV6uxSr_MEuuabFY"}
  @{name="Jesse Vondracek";        stage="delivered"; completedAt="2025-04-01"; fileId="1HlVjIG8NJcPj4yzlBf6xAcjP5yipC3Eh"}
  @{name="Jesse Lubke2";           stage="delivered"; completedAt="2025-04-01"; fileId="1wgUT84bKtSl6BvWCpd6K8FhFtHsD69I0"}
  @{name="Jesse Lubke";            stage="delivered"; completedAt="2025-04-01"; fileId="1e2FqUG1AheQD6HQtOfk61xE12Vr0sQ8a"}
  @{name="Elise Miner";            stage="delivered"; completedAt="2025-04-01"; fileId="1lAdnYU2jl2NM323CUm9ZaUy5oojEu5Wp"}
  @{name="Ben Cardillo";           stage="delivered"; completedAt="2025-04-01"; fileId="1vhQTgaWw58UjjtUoUrFqrsOlmIXVD6T5"}
  @{name="Audrey Davern";          stage="delivered"; completedAt="2025-04-01"; fileId="1cTqBKcFhymm321SyoIvsxnVCCFjSpw4R"}
  @{name="Andrea Tyler";           stage="delivered"; completedAt="2025-04-01"; fileId="1q_WJrpVKz2D6Hz9nvGQgn_O7rO6kJgz_"}

  # ── May 2025 Completed  (delivered, 2025-05-01) ──────────────────────────────
  @{name="Jack Hogan";             stage="delivered"; completedAt="2025-05-01"; fileId="1495uZWyghkhCI-9SCHCrkmu7--4KMl4y"}

  # ── Jun 2025 direct  (delivered, 2025-06-01) ─────────────────────────────────
  @{name="Joanne Carol";           stage="delivered"; completedAt="2025-06-01"; fileId="1Ep_F0HTserFJLhtf0kSDFn7zBlPjvm8f"}
  @{name="Angelique";              stage="delivered"; completedAt="2025-06-01"; fileId="1EBxF-ScoRjyC4GqR_LD9cgBKgXmnZKDQ"}

  # ── Jun 2025 Completed  (delivered, 2025-06-01) ──────────────────────────────
  @{name="Vika And Ben";           stage="delivered"; completedAt="2025-06-01"; fileId="1o4BS8NDOxqLWM3aL1pwwB1Q7E54Edrt8"}
  @{name="Terra Vickner";          stage="delivered"; completedAt="2025-06-01"; fileId="1QekCPZimhHE1WBjLCbdbf9GQ6ko_HAl7"}
  @{name="Robert Martinez";        stage="delivered"; completedAt="2025-06-01"; fileId="15NBbQ2MjFQM3v5Z7RIwdTX5t18_QFUj1"}
  @{name="Loraine Kingsley";       stage="delivered"; completedAt="2025-06-01"; fileId="1-HY3U4d4_1Q-COjGyipNMcrW4BQYwaiZ"}
  @{name="Francois Minoux";        stage="delivered"; completedAt="2025-06-01"; fileId="1PhQmqioyuNiUruHHX_nJylR1aFFz4Dcc"}
  @{name="Darren Surovik";         stage="delivered"; completedAt="2025-06-01"; fileId="1wtg0bBDk3SE-WH9J-6ULGGZmc4s5NXUr"}
  @{name="Conor Edmondson";        stage="delivered"; completedAt="2025-06-01"; fileId="1kNWI7oNaohleSl6q8ZyDuO4L7AvazC9J"}
  @{name="Cesar And Ryan";         stage="delivered"; completedAt="2025-06-01"; fileId="1_nw9vur98wl-RwR3OzV5dX2lEpZTZFYX"}
  @{name="Ani Colt";               stage="delivered"; completedAt="2025-06-01"; fileId="1zgHdbC6hyu0g02B_-L_Ov2pkKDNN6eTJ"}
  @{name="Adrienne Hardy";         stage="delivered"; completedAt="2025-06-01"; fileId="13EcGdQY-7LhULbnLtZ8rQ07VyI01C5nm"}

  # ── Jun 2025 Cancelled-inactive  (cancelled, 2025-06-01) ─────────────────────
  @{name="Susan Love";             stage="cancelled"; cancelledAt="2025-06-01"; fileId="1pDHSGU3t4R04YfhuY5Ksnq7rWFEYKnr4"}
  @{name="Alexis Rodefor";         stage="cancelled"; cancelledAt="2025-06-01"; fileId="18xYlQxCaJxhARamafDsJ4Cs88py_G5Yb"}

  # ── Sep 2025 completed  (delivered, 2025-09-01) ──────────────────────────────
  @{name="Nick Middleton";         stage="delivered"; completedAt="2025-09-01"; fileId="1zCCCaMQaw7HjI0Ndxc52-3e59aWxAUF4"}
  @{name="Linda";                  stage="delivered"; completedAt="2025-09-01"; fileId="1OTDVXNK15upGAOPxbtv1f43XtQaHlnTT"}
  @{name="Gareth Cornwall";        stage="delivered"; completedAt="2025-09-01"; fileId="1IZULzpzc4ZLKCfg0lfGbPlsnH_7hwhMI"}

  # ── Sep 2025 Limbo  (cancelled, 2025-09-01) ──────────────────────────────────
  @{name="Ashley Davern";          stage="cancelled"; cancelledAt="2025-09-01"; fileId="1DIURa1dHUk5_zbelJXNKmz0rIxNZ0bKe"}

  # ── Oct 2025 Completed  (delivered, 2025-10-01) ──────────────────────────────
  @{name="Shelby Nicole";          stage="delivered"; completedAt="2025-10-01"; fileId="1XLICAjztPw8wO_rsKFsn37b-wOTNtGFD"}
  @{name="Sara Kopetman";          stage="delivered"; completedAt="2025-10-01"; fileId="1Sozfwa9uIvvg6MzRDBF1Yb5kr_xq4YWk"}
  @{name="Sabrina Rusch";          stage="delivered"; completedAt="2025-10-01"; fileId="1bCg2HOhnntEKBnzJp05YRrWGo1af4QMh"}
  @{name="Nelly Carmack";          stage="delivered"; completedAt="2025-10-01"; fileId="1oOLJtY6yIV6j8trFcgWc_SovFKGkfQlo"}
  @{name="Laura Eisenberg";        stage="delivered"; completedAt="2025-10-01"; fileId="1hzhZgx_rw-0QcUQwQ6Z-V31jeupJZCiU"}
  @{name="Jac Clark";              stage="delivered"; completedAt="2025-10-01"; fileId="1xjbFje4LHrSn6MSDO1jNS8Jj917VqPLT"}

  # ── Nov 2025 Completed  (delivered, 2025-11-01) ──────────────────────────────
  @{name="Lisa Brown";             stage="delivered"; completedAt="2025-11-01"; fileId="10ICS8bUngCGK_pRoAjRiLDMncQgx8n2d"}

  # ── Nov 2025 direct  (delivered, 2025-11-01) ─────────────────────────────────
  @{name="Lucy Anderson";          stage="delivered"; completedAt="2025-11-01"; fileId="1l58laDebzSwGN8JA4cw9ZA4G-ZBVoyQE"}

  # ── Jan 2026 Completed  (delivered, 2026-01-01) ──────────────────────────────
  @{name="Sarah Jane Harris";      stage="delivered"; completedAt="2026-01-01"; fileId="1Dg0j8z3Sy4xq-Mb0dqENWD9KjQugTQRh"}
  @{name="Melissa Lopez (DT Market)"; stage="delivered"; completedAt="2026-01-01"; fileId="1u80B1RGIJrqC-2iKjSv5wA5T7YpeGBNO"}
  @{name="Linda Jodry";            stage="delivered"; completedAt="2026-01-01"; fileId="1jL914i928fXznPrMq_-iVqe8RGA-fPys"}
  @{name="Jacob Long";             stage="delivered"; completedAt="2026-01-01"; fileId="1Ib2POjNRtE-oXYE5yIH--IMft_euhcbN"}
  @{name="Ishaiah and Conor";      stage="delivered"; completedAt="2026-01-01"; fileId="1NTgV9k1QlxO_MshNwqLfTR3Uz6Oy8jt_"}
  @{name="Audrey Davern";          stage="delivered"; completedAt="2026-01-01"; fileId="15oKBXPcGHdQNDc6J-BmlYc0zYspX8Rh8"}

  # ── Jan 2026 Cancelled  (cancelled, 2026-01-01) ──────────────────────────────
  @{name="Etsy Estimate";          stage="cancelled"; cancelledAt="2026-01-01"; fileId="1_5ibl_sP-J_7TK4rDKCkBFWOj0AuidM9"}

  # ── Mar 2026 Picked Up  (delivered, 2026-03-01) ──────────────────────────────
  @{name="Nick Martello";          stage="delivered"; completedAt="2026-03-01"; fileId="1c-snxyK0SziXt9l3hwO89zxl3dqjPcgc"}
  @{name="Josh Goff";              stage="delivered"; completedAt="2026-03-01"; fileId="1yvvqn8AlF-preGRDtvYcgNJwA6WjIoJh"}
  @{name="Corey";                  stage="delivered"; completedAt="2026-03-01"; fileId="1o1MrMlWcPu_cjBauORg4KIjGKAF3595x"}

  # ── Apr 2026 Complete  (delivered, 2026-04-01) ───────────────────────────────
  @{name="Zephyr";                 stage="delivered"; completedAt="2026-04-01"; fileId="1z37ewGavmtTXchKXI8khMRJO1KlyRHRm"}
  @{name="Joanne";                 stage="delivered"; completedAt="2026-04-01"; fileId="1ofopEwKlEpsaUPMtkB9pSYka13vxixoo"}
  @{name="Jeanine Egby";           stage="delivered"; completedAt="2026-04-01"; fileId="1wP19DE6_Fv_DkcglUxq9bs-FskGwZiV1"}
  @{name="Annaliese Walsten";      stage="delivered"; completedAt="2026-04-01"; fileId="1tc6b1aQPmXrozlsfKGz6EMU70M2n0dFn"}
)

$total   = $orders.Count
$success = 0
$fail    = 0
$ts      = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

Write-Host "Starting import of $total orders..." -ForegroundColor Cyan

foreach ($o in $orders) {
  $ts++
  $appId  = "u_$ts"
  $pdfUrl = viewUrl $o.fileId

  $body = @{
    id     = $appId
    name   = $o.name
    stage  = $o.stage
    pdfUrl = $pdfUrl
  }
  if ($o.completedAt) { $body.completedAt = $o.completedAt }
  if ($o.cancelledAt) { $body.cancelledAt = $o.cancelledAt }

  try {
    $r = Invoke-RestMethod -Uri $API -Method Post `
         -ContentType "application/json" `
         -Body ($body | ConvertTo-Json -Compress) `
         -ErrorAction Stop
    $success++
    Write-Host "  ✓ [$success/$total] $($o.name)" -ForegroundColor Green
  } catch {
    $fail++
    Write-Host "  ✗ FAILED $($o.name): $_" -ForegroundColor Red
  }

  Start-Sleep -Milliseconds 350   # stay well under Notion rate limit (3 req/s)
}

Write-Host "`nDone. $success succeeded, $fail failed." -ForegroundColor Cyan
