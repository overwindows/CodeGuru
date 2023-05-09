import docx2txt


def extract(docx_path, output_dir_path):
    docx2txt.process(docx_path, output_dir_path)
