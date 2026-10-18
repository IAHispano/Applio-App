# Your voice, your data

Applio does not claim ownership of your recordings, datasets, trained voice models,
or generated audio because you use the app. In the desktop app, training and voice
conversion run on the computer running Applio. Online features have specific
exceptions, explained below.

This guide explains the current desktop implementation and the project's position
on user content. It accompanies the [Terms of Use](TERMS_OF_USE.md) and
[MIT software license](LICENSE); it does not replace them or third-party terms.
Reviewed on 18 October 2026. Older releases, the separate Gradio interface, plugins,
and hosted deployments can behave differently.

## Do I keep control of my voice and files?

Yes. Using Applio does not transfer your existing rights in recordings, datasets,
checkpoints, indexes, or outputs to the project. The MIT license grants permission
to use the **software**; it does not grant Applio permission to reproduce, sell,
publish, or train on your private material. Applio does not acquire such permission
merely because you install it, accept its terms, or run a job.

The app does not automatically publish your model in a model directory or upload
your recordings for the project to train other models. Training your own model
uses your selected dataset on the machine running the engine.

Control of files is different from having every right needed for a particular use.
Other people's voices, recordings, music, pretrained models, and datasets can carry
separate rights and license conditions. The existence of an output does not itself
guarantee exclusive copyright or permission to imitate another person.

## Can I use my model and audio commercially?

The published [Applio terms](https://applio.org/terms-use/) permit commercial use
when the necessary rights and permissions are in place. Check the licenses of
models and datasets you use, any source recordings or music, voice permissions,
and any online speech provider's conditions. Training on your own voice does not
remove restrictions attached to somebody else's source material or model.

## What stays local, and what connects to the internet?

Here, **local** means the computer running Applio's engine. With a cloud notebook,
remote server, shared computer, or hosted Gradio instance, that computer may belong
to someone else. Its operator and storage policies matter.

| Feature | What happens |
| --- | --- |
| Conversion, batch conversion, realtime, training, voice blending, audio analysis, and separation | Audio/model processing runs on the engine host. Required dependencies and processing models may need downloading first. Realtime microphone audio goes to that host. |
| Text to Speech | Edge TTS sends the entered text, or the contents of the selected text file, with voice/rate settings to Microsoft's online speech service. The synthesized audio returns to Applio; subsequent RVC conversion runs locally. This synthesis request does not upload your RVC model or training dataset. |
| Setup, model/media downloads, and update checks | The selected hosting services receive requests for packages, models, URLs, or release metadata. These can involve GitHub, Hugging Face, package repositories, Microsoft, Google Drive, or the host you select. They receive normal connection metadata such as IP address and requested resource. These download requests do not include your private recordings or model weights. Update checks are separate from downloading and installing an update. |
| Bridge Mode | Remote requests and responses travel through a Cloudflare tunnel to the engine host. This can include input audio/text, results, and job information. Approved clients can use the permitted remote features. Stop Bridge and revoke devices when sharing is no longer needed. |
| API & Workflows | Apps you authorize with an API key can invoke supported operations and retrieve their results. Their own services and workflow steps may transmit or retain those results. Keep keys private and revoke access when no longer needed. The local API listens on loopback. |
| Discord Rich Presence | When enabled, activity information is passed to your Discord client: Applio's name, general activity, links, and start time. The built-in presence payload does not contain your recordings, text, or model weights. Disable it in Settings if you do not want this activity shared. |
| Custom Google fonts | Selecting or previewing a Google font, or loading a theme that uses one, requests font resources from Google. The bundled default font needs no Google font request. These requests do not contain your voice files. |
| Bug reports and external links | Diagnostics and screen recordings are prepared locally. Opening the GitHub issue form sends the prefilled diagnostic text in the link to GitHub; recording clips are attached only when you attach them yourself. External sites receive their own requests when opened. Review diagnostics and recordings before sharing. |

The built-in desktop workflows do not automatically send your voice material to
Applio for analytics or training. This is not a promise that every dependency,
operating system, extension, or third-party service makes no network requests.
Third-party providers control their own logging, retention, and service terms;
Applio cannot promise that they keep nothing.

See the [Text to Speech guide](https://docs.applio.org/getting-started/tts/) for the
online synthesis workflow. If you do not want text sent to Microsoft, avoid Text to
Speech, including API speech requests. You can instead record speech yourself or
generate it with a provider you choose, then use Convert Audio locally. Avoiding
TTS does not disable local conversion or training.

## How can I keep a workflow local?

1. Install the engine, dependencies, voice models, and optional processing models
   before working with private material. A feature may need its first model
   download before it works offline.
2. Use local audio files for conversion or training. Avoid online TTS and media
   URLs for that workflow.
3. Leave Bridge stopped, keep API keys private, and disable Discord Rich Presence.
   Use the bundled font. Review custom themes, extensions, and external apps.
4. Keep datasets and models outside cloud-synced/shared folders if you do not
   want those services to copy them. Your operating system's backups and sync tools
   are independent of Applio.
5. For a strictly offline session, disconnect the network after setup and downloads.
   Local features with all required resources can run; online features cannot.

There is no single switch that turns every online feature into a local service.
Keeping downloads or update checks available does not itself upload your voice
files. A network connection being available is different from sending a dataset.

## Where are files kept, and how do I delete them?

Inputs you select, copied/uploaded inputs, outputs, datasets, extracted features,
checkpoints, indexes, caches, logs, and job history can remain on the engine host.
Model storage is configurable; use Settings to inspect the active storage location
and the app's file/folder actions to locate your work. Browser/native app settings
are also stored locally. There is no general automatic deletion deadline for all
of this material.

Stop relevant jobs and realtime sessions before removing files. Delete the source
recordings, imported copies, dataset/preprocessing folders, model checkpoints and
indexes, outputs, and any recordings or logs you no longer need. Removing one
output, clearing job history, or uninstalling the app does not establish that all
related files were removed. Check moved model folders, backups, recycle bins, and
cloud copies too. Ordinary deletion is not a guarantee of forensic erasure.

Applio cannot delete copies you have sent to another person or service. Ask that
recipient or provider about their retention and deletion process.

## Does this also apply to Gradio and older releases?

The desktop app uses its own React/Rust interface. The separate upstream Gradio
interface has different framework and sharing settings. Gradio documents optional
framework analytics; set `GRADIO_ANALYTICS_ENABLED=False` in the environment
**before starting Gradio** to disable those analytics. See the
[Gradio environment-variable reference](https://www.gradio.app/guides/environment-variables).
This does not disable online TTS, downloads, public sharing, or a hosting
provider's own logging.

Do not assume that a historical version such as v0.2.9, a modified distribution,
plugin, public share link, or cloud notebook has the same network behavior as the
current desktop app. Check that version and its launch configuration.

## Can an update claim my existing files?

Applio does not assert retroactive ownership of your files, or permission to use
their contents, through an app update or an amendment to its guidelines. The
published terms do contain an amendment clause; this guide does not remove it or
promise that future software, features, or terms can never change. Review the
terms and release notes supplied with a version before deciding to use it.

## Still unsure?

Start with this guide, the [Terms of Use](TERMS_OF_USE.md), the
[software license](LICENSE), and the [user documentation](https://docs.applio.org/).
For a question specific to your setup, include the app version, whether the engine
is local or hosted, and the feature involved. You do not need to share private
recordings, datasets, or model weights just to ask how data is handled.

Report suspected vulnerabilities through [SECURITY.md](SECURITY.md), rather than
posting sensitive details in public issues or community channels.
