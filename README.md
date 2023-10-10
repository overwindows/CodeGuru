## Project Structure
```
CodeGuru/  
│  
├── docs/  
│   ├── design_document.docx  
│   └── markdown/  
│       └── design_document.md  
│  
├── images/  
│   ├── extracted/  
│   │   ├── image1.png  
│   │   ├── image2.png  
│   │   └── ...  
│   └── descriptions/  
│       ├── image1.txt  
│       ├── image2.txt  
│       └── ...  
│  
├── src/  
│   ├── __init__.py  
│   ├── main.py  
│   ├── word_to_markdown.py  
│   ├── image_extraction.py  
│   ├── image_to_text.py  
|   ├── layout_generation.py
│   └── code_generation.py  
│  
├── output/  
│   └── generated_code/  
│       ├── file1.py  
│       ├── file2.py  
│       └── ...  
│  
└── requirements.txt  
```
- docs/: This directory contains the design document in Word format and the converted Markdown file.
- images/: This directory contains the extracted images from the design document and their corresponding text descriptions.
- src/: This directory contains the source code for the project, including modules for converting the Word file to Markdown, extracting images, converting images to text, and generating code based on the extracted information.
- output/: This directory contains the generated code files based on the design document.
requirements.txt: This file lists the required Python packages for the project.

## Installation
1. Clone the repository.
2. Install the required Python packages using the following command:
```
pip3 install -r requirements.txt
```

## Usage
1. Place the design document in the root directory of the project.
2. Run the following command:
```
python3 -m src.main [-h] [-m MARKDOWN_PATH] [-o OUTPUT_PATH] docx_path
```
where `<docx_path>` is a desgin document in Word format.

## Command Line Usage

### Code Review Generation
```
python3 -m codeguru --task code_review 
```

### Commit Message Generation
```
python3 -m codeguru --task commit_message
```

### Code Document Generation
```
python3 -m codeguru --task function_description
```

### Performance Optimization 
```
python3 -m codeguru --task perf_optimization
```

### Bug Defect and Fixing 
```
python3 -m codeguru --task bug_fix
```

### Test Cases generation
```
python3 -m codeguru --task test_generation
```

### Code Translation
```
python3 -m codeguru --task code_translation
```
