# Manual deployment script for GitHub Pages
Write-Host "Building project for GitHub Pages deployment..." -ForegroundColor Green

# Generate tile registry
Write-Host "Generating tile registry..." -ForegroundColor Yellow
bun run generate-registry

# Build project
Write-Host "Building project..." -ForegroundColor Yellow
$env:NODE_ENV = "production"
bun run build

# Add .nojekyll file
Write-Host "Adding .nojekyll file..." -ForegroundColor Yellow
New-Item -ItemType File -Path "out/.nojekyll" -Force | Out-Null

# Create gh-pages branch and deploy
Write-Host "Deploying to gh-pages branch..." -ForegroundColor Yellow
git checkout --orphan gh-pages
git rm -rf .
Copy-Item -Recurse -Force "out/*" .
git add .
git commit -m "Deploy to GitHub Pages"
git push --force origin gh-pages
git checkout main

Write-Host "Deployment complete! Your site should be available at:" -ForegroundColor Green
Write-Host "https://ravva.github.io/Medieval-Hexagon-Map-Editor/" -ForegroundColor Cyan
