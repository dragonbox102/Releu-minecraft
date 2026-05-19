using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReleuLauncher;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        LauncherLog.Write($"Launcher starting. pid={Environment.ProcessId} path={Environment.ProcessPath}");
        ApplicationConfiguration.Initialize();
        using var context = new LauncherApplicationContext(args);
        Application.Run(context);
    }
}

internal sealed class LauncherApplicationContext : ApplicationContext
{
    private const string GitHubOwner = "dragonbox102";
    private const string GitHubRepo = "Releu-minecraft";
    private const string LauncherAssetName = "Releu-minecraft.exe";
    private const string SkipLauncherUpdateEnv = "RELEU_SKIP_LAUNCHER_UPDATE";
    private static readonly HttpClient GitHubClient = CreateGitHubClient();
    private readonly string[] forwardedArgs;
    private readonly System.Windows.Forms.Timer pollTimer;
    private readonly bool skipLauncherUpdate;
    private SplashForm? splashForm;
    private Process? childProcess;
    private string? readyFilePath;
    private string? readyToken;
    private bool completed;

    public LauncherApplicationContext(string[] args)
    {
        skipLauncherUpdate = string.Equals(
            Environment.GetEnvironmentVariable(SkipLauncherUpdateEnv),
            "1",
            StringComparison.OrdinalIgnoreCase);
        forwardedArgs = args
            .Where((arg) => !string.Equals(arg, "--releu-managed-launcher", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        pollTimer = new System.Windows.Forms.Timer
        {
            Interval = 200,
        };
        pollTimer.Tick += PollTimerOnTick;
        pollTimer.Start();

        splashForm = new SplashForm();
        splashForm.FormClosed += (_, _) => splashForm = null;
        splashForm.Show();

        _ = Task.Run(() => LaunchAsync());
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            pollTimer.Stop();
            pollTimer.Dispose();
            splashForm?.Dispose();
            childProcess?.Dispose();
        }
        base.Dispose(disposing);
    }

    private async Task LaunchAsync()
    {
        try
        {
            LauncherLog.Write("LaunchAsync entered.");
            if (await TryLaunchUpdatedLauncherAsync())
            {
                return;
            }

            UpdateStatus("Checking launcher cache...");
            var launcherTargetPath = await EnsureManagedLauncherCopyAsync();
            LauncherLog.Write($"Using launcher update target {launcherTargetPath}.");

            var manifest = await PayloadManifest.LoadAsync();
            LauncherLog.Write($"Loaded payload manifest version={manifest.Version}.");
            UpdateStatus("Preparing Releu runtime...");
            var runtimeDirectory = await EnsureRuntimeAsync(manifest);
            LauncherLog.Write($"Runtime ready at {runtimeDirectory}.");
            var launchContext = CreateLaunchContext(runtimeDirectory, launcherTargetPath);
            readyFilePath = launchContext.ReadyFilePath;
            readyToken = launchContext.ReadyToken;

            UpdateStatus("Starting Releu...");
            StartChildProcess(launchContext);
        }
        catch (Exception error)
        {
            LauncherLog.Write($"LaunchAsync failed: {error}");
            ShowFatalError(error);
        }
    }

    private async Task<bool> TryLaunchUpdatedLauncherAsync()
    {
        if (skipLauncherUpdate)
        {
            LauncherLog.Write("Launcher update check skipped for this launch.");
            return false;
        }

        try
        {
            var currentExePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(currentExePath))
            {
                LauncherLog.Write("Environment.ProcessPath was empty for launcher update check.");
                return false;
            }

            currentExePath = Path.GetFullPath(currentExePath);
            var currentVersion = ReadLauncherVersion(currentExePath);

            var pendingUpdate = await RestorePendingLauncherUpdateAsync(currentVersion);
            if (pendingUpdate is not null)
            {
                LauncherLog.Write($"Found pending launcher update {pendingUpdate.Version} at {pendingUpdate.FilePath}.");
                UpdateStatus($"Launching updated Releu {pendingUpdate.Version}...");
                if (StartReplacementLauncher(pendingUpdate.FilePath))
                {
                    completed = true;
                    ExitThreadSafe();
                    return true;
                }
            }

            UpdateStatus("Checking GitHub for launcher updates...");
            var release = await FetchLatestLauncherReleaseAsync();
            if (release is null)
            {
                return false;
            }

            if (release.Version.CompareTo(currentVersion) <= 0)
            {
                LauncherLog.Write($"Launcher is already current on {currentVersion}.");
                return false;
            }

            var asset = PickReleaseAsset(release, LauncherAssetName);
            if (asset is null)
            {
                LauncherLog.Write($"GitHub release {release.Version} did not include {LauncherAssetName}.");
                return false;
            }

            UpdateStatus($"Downloading launcher update {release.Version}...");
            var stagedPath = await DownloadLauncherUpdateAsync(asset, release.Version);
            if (!File.Exists(stagedPath))
            {
                LauncherLog.Write("Downloaded launcher update path was not created.");
                return false;
            }

            UpdateStatus($"Launching updated Releu {release.Version}...");
            if (StartReplacementLauncher(stagedPath))
            {
                completed = true;
                ExitThreadSafe();
                return true;
            }
        }
        catch (Exception error)
        {
            LauncherLog.Write($"Launcher update check failed. Continuing with normal launch. {error}");
        }

        return false;
    }

    private async Task<string> EnsureManagedLauncherCopyAsync()
    {
        var currentExePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(currentExePath))
        {
            LauncherLog.Write("Environment.ProcessPath was empty.");
            return GetManagedLauncherPath();
        }

        currentExePath = Path.GetFullPath(currentExePath);

        var managedExePath = GetManagedLauncherPath();
        if (string.Equals(
                currentExePath,
                Path.GetFullPath(managedExePath),
                StringComparison.OrdinalIgnoreCase))
        {
            LauncherLog.Write("Already running from managed launcher path.");
            return managedExePath;
        }

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(managedExePath)!);

            var incomingVersion = ReadLauncherVersion(currentExePath);
            var managedVersion = File.Exists(managedExePath)
                ? ReadLauncherVersion(managedExePath)
                : new Version(0, 0, 0, 0);
            var shouldReplaceManaged = !File.Exists(managedExePath) ||
                managedVersion < incomingVersion ||
                (managedVersion == incomingVersion &&
                    !string.Equals(
                        await ComputeFileHashAsync(currentExePath),
                        await ComputeFileHashAsync(managedExePath),
                        StringComparison.OrdinalIgnoreCase));

            if (shouldReplaceManaged)
            {
                LauncherLog.Write($"Copying launcher to managed path {managedExePath}.");
                File.Copy(currentExePath, managedExePath, true);
            }
            else
            {
                LauncherLog.Write("Managed launcher copy already up to date.");
            }
        }
        catch (Exception error)
        {
            LauncherLog.Write($"Managed launcher cache update failed. Falling back to current exe. {error}");
            return currentExePath;
        }

        if (File.Exists(managedExePath))
        {
            return managedExePath;
        }

        LauncherLog.Write("Managed launcher copy was not available after cache update. Falling back to current exe.");
        return currentExePath;
    }

    private static async Task<LauncherReleaseResponse?> FetchLatestLauncherReleaseAsync()
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases/latest");
        request.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
        request.Headers.TryAddWithoutValidation("User-Agent", "releu-launcher");
        request.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");

        using var response = await GitHubClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Unable to check GitHub releases ({(int)response.StatusCode}).");
        }

        await using var stream = await response.Content.ReadAsStreamAsync();
        var release = await JsonSerializer.DeserializeAsync<LauncherReleaseResponse>(stream);
        if (release is null)
        {
            throw new InvalidOperationException("GitHub release payload was empty.");
        }

        return release;
    }

    private static LauncherReleaseAsset? PickReleaseAsset(
        LauncherReleaseResponse release,
        string preferredAssetName)
    {
        var assets = release.Assets ?? Array.Empty<LauncherReleaseAsset>();
        var preferred = assets.FirstOrDefault((asset) =>
            StringComparer.OrdinalIgnoreCase.Equals(asset.Name, preferredAssetName));
        if (preferred is not null)
        {
            return preferred;
        }

        return assets.FirstOrDefault((asset) =>
            asset.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase));
    }

    private Task<LauncherUpdateCandidate?> RestorePendingLauncherUpdateAsync(Version currentVersion)
    {
        var pendingDir = GetLauncherUpdatePendingDirectory();
        Directory.CreateDirectory(pendingDir);

        LauncherUpdateCandidate? bestCandidate = null;
        foreach (var entry in Directory.EnumerateFiles(
                     pendingDir,
                     $"*-{LauncherAssetName}",
                     SearchOption.TopDirectoryOnly))
        {
            var fileName = Path.GetFileName(entry);
            var version = ParsePendingLauncherUpdateVersion(fileName);
            if (version is null)
            {
                continue;
            }

            if (version.CompareTo(currentVersion) <= 0)
            {
                try
                {
                    File.Delete(entry);
                }
                catch
                {
                }
                continue;
            }

            if (bestCandidate is null || version.CompareTo(bestCandidate.Version) > 0)
            {
                bestCandidate = new LauncherUpdateCandidate(version, entry);
            }
        }

        return Task.FromResult(bestCandidate);
    }

    private async Task<string> DownloadLauncherUpdateAsync(LauncherReleaseAsset asset, Version version)
    {
        var pendingDir = GetLauncherUpdatePendingDirectory();
        Directory.CreateDirectory(pendingDir);

        var finalName = $"{version}-{Path.GetFileName(asset.Name)}";
        var finalPath = Path.Combine(pendingDir, finalName);
        if (File.Exists(finalPath))
        {
            return finalPath;
        }

        var tempPath = $"{finalPath}.download";
        if (File.Exists(tempPath))
        {
            File.Delete(tempPath);
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, asset.BrowserDownloadUrl);
        request.Headers.TryAddWithoutValidation("Accept", "application/octet-stream");
        request.Headers.TryAddWithoutValidation("User-Agent", "releu-launcher");

        using var response = await GitHubClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Unable to download Releu launcher update ({(int)response.StatusCode}).");
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync();
        await using var fileStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await responseStream.CopyToAsync(fileStream);
        await fileStream.FlushAsync();

        if (File.Exists(finalPath))
        {
            File.Delete(finalPath);
        }

        await MoveFileWithRetryAsync(tempPath, finalPath);
        LauncherLog.Write($"Downloaded launcher update {version} to {finalPath}.");
        return finalPath;
    }

    private static async Task MoveFileWithRetryAsync(string sourcePath, string destinationPath)
    {
        const int maxAttempts = 6;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                if (File.Exists(destinationPath))
                {
                    File.Delete(destinationPath);
                }

                File.Move(sourcePath, destinationPath);
                return;
            }
            catch (IOException) when (attempt < maxAttempts)
            {
                await Task.Delay(250 * attempt);
            }
            catch (UnauthorizedAccessException) when (attempt < maxAttempts)
            {
                await Task.Delay(250 * attempt);
            }
        }

        if (File.Exists(destinationPath))
        {
            File.Delete(destinationPath);
        }

        File.Move(sourcePath, destinationPath);
    }

    private bool StartReplacementLauncher(string launcherPath)
    {
        try
        {
            var fullPath = Path.GetFullPath(launcherPath);
            var startInfo = new ProcessStartInfo
            {
                FileName = fullPath,
                WorkingDirectory = Path.GetDirectoryName(fullPath) ?? Environment.CurrentDirectory,
                UseShellExecute = false,
            };

            foreach (var arg in forwardedArgs)
            {
                startInfo.ArgumentList.Add(arg);
            }

            startInfo.Environment[SkipLauncherUpdateEnv] = "1";
            var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Updated launcher process was not created.");
            process.Dispose();
            return true;
        }
        catch (Exception error)
        {
            LauncherLog.Write($"Failed to start replacement launcher: {error}");
            return false;
        }
    }

    private static string GetLauncherUpdatePendingDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Releu",
            "launcher",
            "updates",
            "pending");
    }

    private static Version? ParsePendingLauncherUpdateVersion(string fileName)
    {
        var normalizedFileName = String.IsNullOrWhiteSpace(fileName) ? string.Empty : fileName.Trim();
        if (string.IsNullOrWhiteSpace(normalizedFileName))
        {
            return null;
        }

        var suffix = $"-{LauncherAssetName}";
        if (!normalizedFileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var versionText = normalizedFileName[..^suffix.Length];
        return Version.TryParse(versionText, out var parsed) ? parsed : null;
    }

    private static HttpClient CreateGitHubClient()
    {
        return new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(8),
        };
    }

    private static string GetManagedLauncherPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Releu",
            "launcher",
            "current",
            "Releu-minecraft.exe");
    }

    private static Version ReadLauncherVersion(string exePath)
    {
        var fileVersion = FileVersionInfo.GetVersionInfo(exePath).FileVersion;
        if (Version.TryParse(fileVersion, out var parsed))
        {
            return parsed;
        }

        return new Version(0, 0, 0, 0);
    }

    private static async Task<string> ComputeFileHashAsync(string filePath)
    {
        await using var stream = File.OpenRead(filePath);
        using var sha256 = SHA256.Create();
        var hashBytes = await sha256.ComputeHashAsync(stream);
        return Convert.ToHexString(hashBytes);
    }

    private LaunchContext CreateLaunchContext(string runtimeDirectory, string launcherCurrentExePath)
    {
        var signalsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Releu",
            "launcher",
            "signals");
        Directory.CreateDirectory(signalsDirectory);

        var token = Guid.NewGuid().ToString("N");
        var readyPath = Path.Combine(signalsDirectory, $"ready-{token}.txt");
        if (File.Exists(readyPath))
        {
            File.Delete(readyPath);
        }

        return new LaunchContext(
            Path.Combine(runtimeDirectory, "Releu-minecraft.exe"),
            readyPath,
            token,
            launcherCurrentExePath);
    }

    private async Task<string> EnsureRuntimeAsync(PayloadManifest manifest)
    {
        var runtimeRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Releu",
            "runtime");
        var runtimeDirectory = Path.Combine(runtimeRoot, GetRuntimeDirectoryName(manifest));
        var sentinelPath = Path.Combine(runtimeDirectory, ".payload-manifest.json");

        if (RuntimeMatchesManifest(sentinelPath, manifest))
        {
            LauncherLog.Write("Existing runtime matches embedded manifest.");
            return runtimeDirectory;
        }

        var stagingDirectory = Path.Combine(runtimeRoot, $".staging-{Guid.NewGuid():N}");
        Directory.CreateDirectory(runtimeRoot);
        if (Directory.Exists(stagingDirectory))
        {
            Directory.Delete(stagingDirectory, true);
        }
        Directory.CreateDirectory(stagingDirectory);

        try
        {
            LauncherLog.Write($"Extracting runtime payload into {stagingDirectory}.");
            await ExtractPayloadAsync(stagingDirectory);
            await File.WriteAllTextAsync(
                Path.Combine(stagingDirectory, ".payload-manifest.json"),
                JsonSerializer.Serialize(manifest));

            Directory.Move(stagingDirectory, runtimeDirectory);
            LauncherLog.Write("Runtime extraction complete.");
            return runtimeDirectory;
        }
        catch
        {
            LauncherLog.Write("Runtime extraction failed. Cleaning staging directory.");
            if (Directory.Exists(stagingDirectory))
            {
                Directory.Delete(stagingDirectory, true);
            }
            throw;
        }
    }

    private static string GetRuntimeDirectoryName(PayloadManifest manifest)
    {
        var safeVersion = string.IsNullOrWhiteSpace(manifest.Version)
            ? "runtime"
            : string.Concat(
                manifest.Version.Trim().Select((ch) =>
                    char.IsLetterOrDigit(ch) || ch is '.' or '-' or '_' ? ch : '-'));
        var hashSegment = string.IsNullOrWhiteSpace(manifest.Sha256)
            ? "payload"
            : manifest.Sha256.Trim().ToLowerInvariant()[..Math.Min(12, manifest.Sha256.Trim().Length)];
        return $"{safeVersion}-{hashSegment}";
    }

    private static bool RuntimeMatchesManifest(string sentinelPath, PayloadManifest expectedManifest)
    {
        if (!File.Exists(sentinelPath))
        {
            return false;
        }

        try
        {
            var manifest = JsonSerializer.Deserialize<PayloadManifest>(File.ReadAllText(sentinelPath));
            return manifest is not null &&
                string.Equals(manifest.Version, expectedManifest.Version, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(manifest.Sha256, expectedManifest.Sha256, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static async Task ExtractPayloadAsync(string targetDirectory)
    {
        await using var payloadStream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream("ReleuLauncher.Payload.runtime.zip")
            ?? throw new InvalidOperationException("Embedded runtime payload was not found.");
        LauncherLog.Write("Embedded runtime payload stream opened.");
        using var archive = new ZipArchive(payloadStream, ZipArchiveMode.Read);

        foreach (var entry in archive.Entries)
        {
            var destinationPath = Path.GetFullPath(Path.Combine(targetDirectory, entry.FullName));
            if (!destinationPath.StartsWith(Path.GetFullPath(targetDirectory), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Payload entry attempted to escape the runtime directory.");
            }

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destinationPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            await using var sourceStream = entry.Open();
            await using var destinationStream = new FileStream(
                destinationPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None);
            await sourceStream.CopyToAsync(destinationStream);
        }
    }

    private void StartChildProcess(LaunchContext context)
    {
        if (!File.Exists(context.ExecutablePath))
        {
            throw new FileNotFoundException("The embedded Releu runtime executable was not found after extraction.", context.ExecutablePath);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = context.ExecutablePath,
            WorkingDirectory = Path.GetDirectoryName(context.ExecutablePath)!,
            UseShellExecute = false,
        };

        foreach (var argument in forwardedArgs)
        {
            startInfo.ArgumentList.Add(argument);
        }

        startInfo.Environment["RELEU_EXTERNAL_LAUNCHER"] = "1";
        startInfo.Environment["RELEU_LAUNCHER_CURRENT_EXE"] = context.ManagedLauncherPath;
        startInfo.Environment["RELEU_LAUNCHER_READY_FILE"] = context.ReadyFilePath;
        startInfo.Environment["RELEU_LAUNCHER_READY_TOKEN"] = context.ReadyToken;

        childProcess = Process.Start(startInfo) ?? throw new InvalidOperationException("Releu failed to start.");
        LauncherLog.Write($"Started inner Releu runtime from {context.ExecutablePath}. pid={childProcess.Id}");
        childProcess.EnableRaisingEvents = true;
        childProcess.Exited += (_, _) =>
        {
            if (completed)
            {
                return;
            }

            if (childProcess?.ExitCode == 0)
            {
                completed = true;
                TryDeleteSignalFile();
                LauncherLog.Write("Inner Releu runtime exited cleanly before ready signal. Treating as existing-instance handoff.");
                ExitThreadSafe();
                return;
            }

            LauncherLog.Write("Inner Releu runtime exited before ready signal.");
            ShowFatalError(new InvalidOperationException("Releu exited before the main window was ready."));
        };
    }

    private void PollTimerOnTick(object? sender, EventArgs eventArgs)
    {
        if (completed || string.IsNullOrWhiteSpace(readyFilePath) || string.IsNullOrWhiteSpace(readyToken))
        {
            return;
        }

        if (!File.Exists(readyFilePath))
        {
            return;
        }

        try
        {
            var token = File.ReadAllText(readyFilePath).Trim();
            if (!string.Equals(token, readyToken, StringComparison.Ordinal))
            {
                return;
            }
        }
        catch
        {
            return;
        }

        completed = true;
        TryDeleteSignalFile();
        LauncherLog.Write("Received ready signal from inner Releu runtime.");
        ExitThreadSafe();
    }

    private void TryDeleteSignalFile()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(readyFilePath) && File.Exists(readyFilePath))
            {
                File.Delete(readyFilePath);
            }
        }
        catch
        {
        }
    }

    private void ShowFatalError(Exception error)
    {
        if (completed)
        {
            return;
        }

        completed = true;
        TryDeleteSignalFile();
        var message = error.Message;
        LauncherLog.Write($"Fatal launcher error: {message}");
        if (splashForm is not null && !splashForm.IsDisposed)
        {
            splashForm.BeginInvoke(() =>
            {
                MessageBox.Show(
                    splashForm,
                    message,
                    "Releu failed to start",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                ExitThreadSafe();
            });
            return;
        }

        MessageBox.Show(
            message,
            "Releu failed to start",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
        ExitThreadSafe();
    }

    private void UpdateStatus(string message)
    {
        if (splashForm is null || splashForm.IsDisposed)
        {
            return;
        }

        if (splashForm.InvokeRequired)
        {
            splashForm.BeginInvoke(() => splashForm.SetStatus(message));
            return;
        }

        splashForm.SetStatus(message);
    }

    private void ExitThreadSafe()
    {
        if (splashForm is not null && !splashForm.IsDisposed)
        {
            LauncherLog.Write("Closing splash and exiting launcher thread.");
            splashForm.BeginInvoke(() =>
            {
                splashForm.Close();
                ExitThread();
            });
            return;
        }

        LauncherLog.Write("Exiting launcher thread without splash window.");
        ExitThread();
    }
}

internal sealed record LaunchContext(
    string ExecutablePath,
    string ReadyFilePath,
    string ReadyToken,
    string ManagedLauncherPath);

internal sealed record LauncherUpdateCandidate(Version Version, string FilePath);

internal sealed record LauncherReleaseAsset(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("browser_download_url")] string BrowserDownloadUrl);

internal sealed record LauncherReleaseResponse(
    [property: JsonPropertyName("tag_name")] string TagName,
    [property: JsonPropertyName("html_url")] string HtmlUrl,
    [property: JsonPropertyName("assets")] LauncherReleaseAsset[]? Assets)
{
    public System.Version Version => System.Version.TryParse(
        string.IsNullOrWhiteSpace(TagName) ? "0.0.0" : TagName.Trim().TrimStart('v', 'V'),
        out var parsed)
        ? parsed
        : new System.Version(0, 0, 0, 0);
}

internal sealed record PayloadManifest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sha256")] string Sha256)
{
    public static async Task<PayloadManifest> LoadAsync()
    {
        await using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream("ReleuLauncher.Payload.manifest.json")
            ?? throw new InvalidOperationException("Embedded payload manifest was not found.");
        var manifest = await JsonSerializer.DeserializeAsync<PayloadManifest>(stream);
        return manifest ?? throw new InvalidOperationException("Embedded payload manifest is invalid.");
    }
}

internal sealed class SplashForm : Form
{
    private readonly Label statusLabel;

    public SplashForm()
    {
        AutoScaleMode = AutoScaleMode.Font;
        BackColor = Color.FromArgb(11, 13, 16);
        ClientSize = new Size(430, 190);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Opening Releu";
        Font = new Font("Inter", 9f, FontStyle.Regular, GraphicsUnit.Point);

        var shellPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(22, 18, 22, 16),
            BackColor = Color.FromArgb(11, 13, 16),
        };

        var cardPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20, 18, 20, 16),
            BackColor = Color.FromArgb(20, 24, 29),
        };

        var titleLabel = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 44,
            Font = new Font("Inter", 21f, FontStyle.Bold, GraphicsUnit.Point),
            ForeColor = Color.White,
            Text = "Opening Releu...",
            TextAlign = ContentAlignment.BottomCenter,
        };

        statusLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 40,
            Font = new Font("Inter", 10f, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = Color.FromArgb(160, 169, 180),
            Text = "Preparing the local panel. This can take a few seconds.",
            TextAlign = ContentAlignment.TopCenter,
        };

        var progressBar = new ProgressBar
        {
            Dock = DockStyle.Top,
            Height = 10,
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 30,
            Margin = new Padding(0, 10, 0, 0),
        };

        var detailLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 26,
            Font = new Font("Inter", 8.5f, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = Color.FromArgb(107, 114, 128),
            Text = "Checking launcher updates, Java runtimes, and playit.gg tools.",
            TextAlign = ContentAlignment.MiddleCenter,
            Padding = new Padding(0, 10, 0, 0),
        };

        var closeHintLabel = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 22,
            Font = new Font("Inter", 8f, FontStyle.Regular, GraphicsUnit.Point),
            ForeColor = Color.FromArgb(94, 102, 114),
            Text = "Close this window anytime. Releu keeps launching.",
            TextAlign = ContentAlignment.MiddleCenter,
        };

        cardPanel.Controls.Add(closeHintLabel);
        cardPanel.Controls.Add(detailLabel);
        cardPanel.Controls.Add(progressBar);
        cardPanel.Controls.Add(statusLabel);
        cardPanel.Controls.Add(titleLabel);
        shellPanel.Controls.Add(cardPanel);
        Controls.Add(shellPanel);
    }

    public void SetStatus(string message)
    {
        statusLabel.Text = message;
    }
}

internal static class LauncherLog
{
    private static readonly object Sync = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Releu",
        "launcher",
        "launcher.log");

    public static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(
                    LogPath,
                    $"{DateTime.UtcNow:O} {message}{Environment.NewLine}");
            }
        }
        catch
        {
        }
    }
}
